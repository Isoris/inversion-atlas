# ============================================================================
# bp5_ribbon_lib.R — pure library for BP_ATLAS ribbon plotting.
#
# Sourced by:
#   - STEP_BP5c_ribbons.R       (single-chromosome CLI)
#   - STEP_BP5c_montage.R       (genome-wide CLI: per-chrom multi-page PDF
#                                or grid-tile montage)
#   - (later) any other R driver that needs a ribbon plot
#
# No CLI, no side effects on load. Exposes:
#
#   load_atlas(json_path)
#     -> list with parsed `atlas_data.json` fields, augmented with cached
#        helper data.tables (haplotypes, hap_chroms, zones, hap_lane_lookup).
#
#   build_ribbon_plot(atlas, anchor, chrom, options = list())
#     -> ggplot object for one (anchor, chrom). Throws errors with clear
#        messages if anchor/chrom invalid. Returns NULL if zone-set is
#        empty AND options$skip_empty is TRUE (used by montage to filter
#        chroms with no events).
#
#   save_plot(p, out_prefix, width_in, height_in, dpi)
#     -> writes <prefix>.pdf and <prefix>.png. Logs paths to stderr.
#
# Coordinate convention (same as the Curcuma supplementary figure that
# inspired the design): all tracks are drawn on the ANCHOR'S coordinates.
# Non-anchor-species haplotypes appear at the anchor's zone position;
# their actual partner coordinate is captured in zone$partner_loci.
# ============================================================================

# Helpers — defined eagerly so any caller (script or another lib) can use them.
`%||%` <- function(a, b) if (is.null(a) || length(a) == 0L) b else a


# ---------------------------------------------------------------------------
# load_atlas: read atlas_data.json and pre-build the helper tables.
# ---------------------------------------------------------------------------
load_atlas <- function(json_path) {
    suppressPackageStartupMessages({
        library(jsonlite)
        library(data.table)
    })
    atlas <- fromJSON(json_path, simplifyDataFrame = FALSE)

    # Flatten haplotype × chromosome list into one data.table
    hap_chroms <- rbindlist(lapply(atlas$haplotypes, function(h) {
        if (length(h$chromosomes) == 0L) return(NULL)
        data.table(
            haplotype_id = h$haplotype_id,
            species      = h$species,
            qc_tier      = h$qc_tier,
            chrom        = vapply(h$chromosomes, `[[`, character(1), "name"),
            chrom_length = vapply(h$chromosomes, `[[`, numeric(1),  "length")
        )
    }), fill = TRUE)

    # Flat haplotype list (one row per haplotype)
    all_haps <- rbindlist(lapply(atlas$haplotypes, function(h) {
        data.table(
            haplotype_id = h$haplotype_id,
            species      = h$species,
            qc_tier      = h$qc_tier
        )
    }))
    all_haps[, manifest_order := seq_len(.N)]

    # Zones as a flat typed data.table
    zones <- rbindlist(lapply(atlas$zones, function(z) {
        data.table(
            zone_uid           = z$zone_uid,
            zone_id            = z$zone_id,
            zone_kind          = z$zone_kind %||% "inversion",
            anchor_species     = z$anchor_species,
            chrom              = z$chrom,
            zone_start         = as.numeric(z$zone_start),
            zone_end           = as.numeric(z$zone_end),
            zone_centroid      = as.numeric(z$zone_centroid),
            support_pairs      = z$support_pairs %||% "",
            support_pair_count = as.integer(z$support_pair_count %||% 0L),
            confidence         = z$confidence %||% "low",
            dominant_event     = z$dominant_event_type %||% z$event_classes %||% "",
            reciprocal_zone_id = z$reciprocal_zone_id %||% "none"
        )
    }), fill = TRUE)

    list(
        anchors    = atlas$anchors,
        haplotypes = atlas$haplotypes,
        hap_chroms = hap_chroms,
        all_haps   = all_haps,
        zones      = zones,
        summary    = atlas$summary
    )
}


# ---------------------------------------------------------------------------
# parse_pair_haps: "Cgar_h1__vs__Cmac_h1; Cgar_h1__vs__Cmac_h2" -> c("Cgar_h1","Cmac_h1","Cmac_h2")
# ---------------------------------------------------------------------------
parse_pair_haps <- function(s) {
    if (is.null(s) || is.na(s) || nchar(s) == 0L) return(character(0))
    pieces <- trimws(unlist(strsplit(s, ";", fixed = TRUE)))
    haps   <- character(0)
    for (p in pieces) {
        sp <- strsplit(p, "__vs__", fixed = TRUE)[[1]]
        if (length(sp) == 2L) haps <- c(haps, sp)
    }
    unique(haps)
}


# ---------------------------------------------------------------------------
# build_ribbon_plot: returns a ggplot for one (anchor, chrom).
#
# options is a named list:
#   include_transloc       (logical, default FALSE) include INTERCHROM zones
#   min_support            (int,     default 1)     min support_pair_count
#   min_confidence         (str,     default "low") "low"|"medium"|"high"
#   min_lens_width_frac    (num,     default 0.005) min lens width / chrom_len
#   skip_empty             (logical, default FALSE) return NULL if no zones
#   title_extra            (str,     default "")    appended to plot title
#   show_legend            (logical, default TRUE)  hide for small montage tiles
#
# Returns: ggplot object, or NULL if skip_empty=TRUE and no zones to plot.
# Throws: descriptive error if anchor missing from atlas, or chrom missing
# from anchor.
# ---------------------------------------------------------------------------
build_ribbon_plot <- function(atlas, anchor, chrom_name, options = list()) {
    suppressPackageStartupMessages({
        library(data.table)
        library(ggplot2)
    })

    # Defaults
    opt <- modifyList(list(
        include_transloc    = FALSE,
        min_support         = 1L,
        min_confidence      = "low",
        min_lens_width_frac = 0.005,
        skip_empty          = FALSE,
        title_extra         = "",
        show_legend         = TRUE
    ), options)

    # Sanity check
    if (!(anchor %in% atlas$anchors))
        stop(sprintf("anchor '%s' not in atlas$anchors (have: %s)",
                     anchor, paste(atlas$anchors, collapse = ", ")),
             call. = FALSE)

    conf_rank <- c(low = 1L, medium = 2L, high = 3L)
    if (!(opt$min_confidence %in% names(conf_rank)))
        stop("min_confidence must be one of: low, medium, high", call. = FALSE)
    min_conf_int <- conf_rank[[opt$min_confidence]]

    # Filter zones to this (anchor, chrom)
    # Variables `anchor` and `chrom_name` are function args from the parent
    # frame; data.table evaluates bare names as columns first, then falls
    # back to the parent frame for non-matching names. The args are
    # deliberately renamed (chrom_name not chrom) to avoid collision.
    zones_dt <- atlas$zones[
        anchor_species == anchor &
        chrom == chrom_name &
        support_pair_count >= opt$min_support &
        conf_rank[confidence] >= min_conf_int
    ]
    if (!opt$include_transloc)
        zones_dt <- zones_dt[zone_kind == "inversion"]

    # Empty-zone shortcut for montage mode
    if (nrow(zones_dt) == 0L && opt$skip_empty)
        return(NULL)

    # Anchor haplotype + chromosome length
    anchor_hap_row <- atlas$hap_chroms[species == anchor & chrom == chrom_name]
    if (nrow(anchor_hap_row) == 0L)
        stop(sprintf("Chromosome '%s' not found on any %s haplotype",
                     chrom_name, anchor), call. = FALSE)
    anchor_hap_row <- anchor_hap_row[order(qc_tier != "A")]
    chrom_len      <- anchor_hap_row$chrom_length[1]
    anchor_hap_id  <- anchor_hap_row$haplotype_id[1]

    # Lane ranks: 1=anchor hap, 2=same species, 3=other species
    all_haps <- copy(atlas$all_haps)
    all_haps[, lane_rank := fifelse(haplotype_id == anchor_hap_id, 1L,
                            fifelse(species == anchor, 2L, 3L))]
    setorder(all_haps, lane_rank, manifest_order)
    all_haps[, lane := seq_len(.N)]
    n_tracks <- nrow(all_haps)

    # Per-zone supporting haplotypes -> lanes
    zones_dt[, supporting_haps := lapply(support_pairs, parse_pair_haps)]
    hap_lane_lookup <- setNames(all_haps$lane, all_haps$haplotype_id)
    zone_lanes <- zones_dt[, {
        haps  <- supporting_haps[[1]]
        lanes <- as.integer(hap_lane_lookup[haps])
        lanes <- lanes[!is.na(lanes)]
        .(lane = lanes)
    }, by = .(zone_uid, zone_id, zone_kind, chrom, zone_start, zone_end,
             zone_centroid, support_pair_count, confidence, dominant_event)]

    # Ribbons: adjacent-supporting-lane pairs per zone
    ribbon_segs <- zone_lanes[, {
        if (.N < 2L) {
            data.table()
        } else {
            ord <- sort(lane)
            data.table(lane_from = ord[-length(ord)], lane_to = ord[-1L])
        }
    }, by = .(zone_uid, zone_kind, zone_start, zone_end, zone_centroid,
             confidence)]

    # Lens polygons with minimum-visual-width floor
    lens_min_halfwidth <- chrom_len * opt$min_lens_width_frac / 2
    if (nrow(ribbon_segs) > 0L) {
        ribbon_polys <- ribbon_segs[, {
            midy   <- (lane_from + lane_to) / 2
            zone_halfwidth <- (zone_end - zone_start) / 2
            viz_halfwidth  <- max(zone_halfwidth, lens_min_halfwidth)
            xleft  <- zone_centroid - viz_halfwidth
            xright <- zone_centroid + viz_halfwidth
            data.table(
                x = c(xleft, zone_centroid, xright, zone_centroid),
                y = c(midy, lane_from + 0.35, midy, lane_to - 0.35),
                vertex = 1:4
            )
        }, by = .(zone_uid, zone_kind, confidence)]
        ribbon_polys[, ribbon_id := paste0(zone_uid, "_lens",
                                           cumsum(vertex == 1L))]
    } else {
        ribbon_polys <- data.table(
            zone_uid = character(0), zone_kind = character(0),
            confidence = character(0), x = numeric(0), y = numeric(0),
            vertex = integer(0), ribbon_id = character(0)
        )
    }

    # Aesthetics
    species_pal <- c(Cgar = "#1f6fb4", Cmac = "#e07b00")
    zone_fill   <- c(inversion = "#c0392b", translocation = "#8e44ad")
    conf_alpha  <- c(low = 0.25, medium = 0.55, high = 0.85)

    plot_dt_tracks <- all_haps[, .(haplotype_id, species, qc_tier, lane)]
    plot_dt_tracks[, track_xmin := 0]
    plot_dt_tracks[, track_xmax := chrom_len]

    zone_lanes[, ymin := lane - 0.35]
    zone_lanes[, ymax := lane + 0.35]

    # Build the ggplot
    title_main <- sprintf("anchor = %s  -  %s", anchor, chrom_name)
    if (nchar(opt$title_extra) > 0L)
        title_main <- paste0(title_main, "  ", opt$title_extra)

    p <- ggplot() +
        geom_segment(
            data = plot_dt_tracks,
            aes(x = track_xmin, xend = track_xmax,
                y = lane,       yend = lane,
                color = species),
            linewidth = 0.8
        ) +
        geom_rect(
            data = zone_lanes,
            aes(xmin = zone_start, xmax = zone_end,
                ymin = ymin,       ymax = ymax,
                fill = zone_kind,  alpha = confidence),
            color = NA
        ) +
        {
            if (nrow(ribbon_polys) > 0L) {
                geom_polygon(
                    data = ribbon_polys,
                    aes(x = x, y = y, group = ribbon_id,
                        fill = zone_kind, alpha = confidence),
                    color = NA
                )
            } else NULL
        } +
        scale_x_continuous(
            name   = "Chromosome position (Mb)",
            labels = function(x) sprintf("%.1f", x / 1e6),
            limits = c(0, chrom_len),
            expand = expansion(mult = c(0.01, 0.01))
        ) +
        scale_y_reverse(
            name   = NULL,
            breaks = all_haps$lane,
            labels = all_haps$haplotype_id,
            expand = expansion(add = c(0.6, 0.6))
        ) +
        scale_color_manual(values = species_pal, name = "Species") +
        scale_fill_manual(values  = zone_fill,   name = "Zone kind",
                          limits = names(zone_fill), drop = FALSE) +
        scale_alpha_manual(
            values = conf_alpha,
            name   = "Confidence",
            breaks = c("high", "medium", "low"),
            limits = c("high", "medium", "low"),
            drop   = FALSE
        ) +
        labs(
            title    = title_main,
            subtitle = sprintf(
                "%d zones (support >= %d, confidence >= %s)  -  %d haplotype lanes",
                nrow(zones_dt), opt$min_support,
                opt$min_confidence, n_tracks
            )
        ) +
        theme_minimal(base_size = 11) +
        theme(
            axis.text.y         = element_text(family = "mono", size = 9),
            panel.grid.minor    = element_blank(),
            panel.grid.major.y  = element_blank(),
            panel.grid.major.x  = element_line(color = "grey90", linewidth = 0.3),
            plot.title          = element_text(face = "bold"),
            plot.subtitle       = element_text(color = "grey40", size = 9),
            legend.position     = if (opt$show_legend) "right" else "none"
        )

    p
}


# ---------------------------------------------------------------------------
# save_plot: writes <prefix>.pdf + <prefix>.png with logging.
# ---------------------------------------------------------------------------
save_plot <- function(p, out_prefix, width_in = 14, height_in = NA, dpi = 200) {
    suppressPackageStartupMessages({ library(ggplot2) })
    out_dir <- dirname(out_prefix)
    if (nchar(out_dir) > 0L && !dir.exists(out_dir))
        dir.create(out_dir, recursive = TRUE)
    pdf_path <- paste0(out_prefix, ".pdf")
    png_path <- paste0(out_prefix, ".png")
    if (is.na(height_in)) height_in <- 6
    ggsave(pdf_path, p, width = width_in, height = height_in,
           device = "pdf", useDingbats = FALSE)
    ggsave(png_path, p, width = width_in, height = height_in,
           device = "png", dpi = dpi)
    message("[bp5lib] wrote ", pdf_path)
    message("[bp5lib] wrote ", png_path)
    invisible(c(pdf = pdf_path, png = png_path))
}


# ---------------------------------------------------------------------------
# list_chroms_with_zones: helper for montage — returns chrom names with at
# least one zone matching the filters, sorted by descending zone count.
# ---------------------------------------------------------------------------
list_chroms_with_zones <- function(atlas, anchor,
                                   min_support    = 1,
                                   min_confidence = "low",
                                   include_transloc = FALSE) {
    conf_rank <- c(low = 1L, medium = 2L, high = 3L)
    z <- atlas$zones[
        anchor_species == anchor &
        support_pair_count >= min_support &
        conf_rank[confidence] >= conf_rank[[min_confidence]]
    ]
    if (!include_transloc) z <- z[zone_kind == "inversion"]
    if (nrow(z) == 0L) return(character(0))
    counts <- z[, .N, by = chrom][order(-N)]
    counts$chrom
}
