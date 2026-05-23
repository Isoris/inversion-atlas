#!/usr/bin/env Rscript
# ============================================================================
# STEP_BP5c_montage.R — genome-wide ribbon montage
#
# Builds ribbon plots for every chromosome that has zones (on the chosen
# anchor) and assembles them into a multi-page PDF or a single tiled-grid
# figure. Reuses bp5_ribbon_lib.R so the per-chrom rendering is identical
# to STEP_BP5c_ribbons.R.
#
# Two modes (--mode):
#
#   per-chrom (default):
#       One chrom per page. Outputs:
#         <out_prefix>.pdf       (multi-page; one chrom per page)
#         <out_prefix>_<chrom>.png   (one PNG per chrom, in <out_prefix>_png/)
#       Use this when you want a paper-quality supplementary atlas.
#
#   grid:
#       All chroms tiled in a single figure (patchwork::wrap_plots).
#       Outputs:
#         <out_prefix>_grid.pdf
#         <out_prefix>_grid.png
#       Legend appears once on the side. Use this for a single-page
#       genome overview figure.
#
# Both modes default to "chroms with at least one matching zone", sorted
# by descending zone count. Use --include-empty-chroms to draw every
# anchor chrom (will be many blank panels).
#
# Usage:
#   Rscript STEP_BP5c_montage.R \
#       --atlas-json results_bpatlas/05_atlas_data/atlas_data.json \
#       --anchor     Cgar \
#       --mode       per-chrom \
#       --out-prefix results_bpatlas/05_atlas_data/figures/montage_Cgar \
#       [--include-transloc] [--min-support 1] [--min-confidence low] \
#       [--include-empty-chroms]
#
# Dependencies: jsonlite, ggplot2, data.table, optparse, patchwork
# ============================================================================
suppressPackageStartupMessages({
    library(optparse)
})

resolve_script_dir <- function() {
    args <- commandArgs(trailingOnly = FALSE)
    file_arg <- args[grep("^--file=", args)]
    if (length(file_arg) > 0L)
        return(dirname(normalizePath(sub("^--file=", "", file_arg[1]))))
    getwd()
}
script_dir <- resolve_script_dir()
source(file.path(script_dir, "bp5_ribbon_lib.R"))

opt_list <- list(
    make_option("--atlas-json", type = "character", default = NULL,
                help = "Path to atlas_data.json"),
    make_option("--anchor", type = "character", default = "Cgar",
                help = "Anchor species frame [default: %default]"),
    make_option("--mode", type = "character", default = "per-chrom",
                help = "'per-chrom' (multi-page PDF) or 'grid' (single tiled figure) [default: %default]"),
    make_option("--out-prefix", type = "character", default = NULL,
                help = "Output prefix"),
    make_option("--include-transloc", action = "store_true", default = FALSE,
                help = "Also draw translocation zones"),
    make_option("--include-empty-chroms", action = "store_true", default = FALSE,
                help = "Include every anchor chrom even if it has no zones (default: only chroms with zones)"),
    make_option("--min-support", type = "integer", default = 1,
                help = "Minimum support_pair_count [default: %default]"),
    make_option("--min-confidence", type = "character", default = "low",
                help = "Minimum confidence: low|medium|high [default: %default]"),
    make_option("--min-lens-width-frac", type = "double", default = 0.005,
                help = "Min lens width / chrom length [default: %default]"),
    make_option("--width-in", type = "double", default = 14,
                help = "Per-page (per-chrom mode) or full-figure (grid mode) width in inches [default: %default]"),
    make_option("--height-in", type = "double", default = NA,
                help = "Per-page (per-chrom) or full-figure (grid) height in inches [default: auto]"),
    make_option("--grid-ncol", type = "integer", default = 2,
                help = "Columns in grid mode [default: %default]"),
    make_option("--dpi", type = "integer", default = 200,
                help = "PNG raster DPI [default: %default]")
)
opt <- parse_args(OptionParser(option_list = opt_list))

if (is.null(opt$`atlas-json`)) stop("--atlas-json is required", call. = FALSE)
if (is.null(opt$`out-prefix`)) stop("--out-prefix is required", call. = FALSE)
if (!(opt$mode %in% c("per-chrom", "grid")))
    stop("--mode must be 'per-chrom' or 'grid'", call. = FALSE)

# ---------------------------------------------------------------------------
# Load atlas once + determine which chroms to plot
# ---------------------------------------------------------------------------
message("[BP5c-montage] Reading ", opt$`atlas-json`)
atlas <- load_atlas(opt$`atlas-json`)

if (opt$`include-empty-chroms`) {
    # All chroms where the anchor species has a contig in the .fai
    chrom_list <- unique(atlas$hap_chroms[species == opt$anchor, chrom])
    chrom_list <- sort(chrom_list)
} else {
    chrom_list <- list_chroms_with_zones(
        atlas, opt$anchor,
        min_support      = opt$`min-support`,
        min_confidence   = opt$`min-confidence`,
        include_transloc = opt$`include-transloc`
    )
}

if (length(chrom_list) == 0L) {
    # Touch an empty PDF so downstream consumers don't break on a missing file
    message("[BP5c-montage] No chroms match the filters; writing empty PDF stub")
    pdf(paste0(opt$`out-prefix`, ".pdf"), width = 8, height = 5)
    plot.new()
    title("BP_ATLAS montage  -  no chromosomes match filters")
    dev.off()
    quit(status = 0)
}

message(sprintf("[BP5c-montage] %d chromosomes to plot (anchor=%s, mode=%s)",
                length(chrom_list), opt$anchor, opt$mode))

# ---------------------------------------------------------------------------
# Plot builder shared by both modes — small closure so options aren't
# repeated.
# ---------------------------------------------------------------------------
make_plot <- function(chrom_name, show_legend = TRUE) {
    build_ribbon_plot(atlas, opt$anchor, chrom_name, options = list(
        include_transloc    = opt$`include-transloc`,
        min_support         = as.integer(opt$`min-support`),
        min_confidence      = opt$`min-confidence`,
        min_lens_width_frac = opt$`min-lens-width-frac`,
        skip_empty          = !opt$`include-empty-chroms`,
        show_legend         = show_legend,
        title_extra         = ""
    ))
}

# ---------------------------------------------------------------------------
# Mode: per-chrom (multi-page PDF + per-chrom PNG)
# ---------------------------------------------------------------------------
if (opt$mode == "per-chrom") {
    suppressPackageStartupMessages({ library(ggplot2) })

    # Page size
    n_tracks <- nrow(atlas$all_haps)
    page_h <- if (is.na(opt$`height-in`)) max(4.5, 0.6 * n_tracks + 2.5) else opt$`height-in`
    page_w <- opt$`width-in`

    pdf_path <- paste0(opt$`out-prefix`, ".pdf")
    png_dir  <- paste0(opt$`out-prefix`, "_png")
    if (!dir.exists(dirname(pdf_path)))
        dir.create(dirname(pdf_path), recursive = TRUE)
    if (!dir.exists(png_dir))
        dir.create(png_dir, recursive = TRUE)

    pdf(pdf_path, width = page_w, height = page_h, useDingbats = FALSE)
    on.exit(dev.off(), add = TRUE)

    n_done <- 0L
    for (ch in chrom_list) {
        p <- tryCatch(make_plot(ch, show_legend = TRUE),
                      error = function(e) {
                          message(sprintf("[BP5c-montage] %s: %s",
                                          ch, conditionMessage(e)))
                          NULL
                      })
        if (is.null(p)) next  # skip_empty fired, no zones here
        print(p)
        # Also write per-chrom PNG
        # Sanitize chrom name for filename
        safe_ch <- gsub("[^A-Za-z0-9_.-]", "_", ch)
        png_path <- file.path(png_dir, sprintf("ribbon_%s_%s.png",
                                               opt$anchor, safe_ch))
        ggsave(png_path, p, width = page_w, height = page_h,
               device = "png", dpi = opt$dpi)
        n_done <- n_done + 1L
    }
    message(sprintf("[BP5c-montage] Wrote %d pages -> %s", n_done, pdf_path))
    message(sprintf("[BP5c-montage] Wrote %d PNGs -> %s/", n_done, png_dir))
}

# ---------------------------------------------------------------------------
# Mode: grid (all chroms tiled into one figure via patchwork)
# ---------------------------------------------------------------------------
if (opt$mode == "grid") {
    suppressPackageStartupMessages({
        library(ggplot2)
    })
    # patchwork is only needed for grid mode (per-chrom multi-page PDF
    # works without it). Fail with a useful message rather than the
    # cryptic "no package called 'patchwork'" if it's missing.
    if (!requireNamespace("patchwork", quietly = TRUE)) {
        msg <- c(
            "[BP5c-montage] grid mode requires the 'patchwork' R package, which",
            "                is not installed in this R environment.",
            "",
            "  Install it with:",
            "    mamba install -n assembly -c conda-forge r-patchwork",
            "",
            "  Or skip grid mode (per-chrom multi-page PDF mode works without it):",
            "    Rscript STEP_BP5c_montage.R --mode per-chrom ..."
        )
        message(paste(msg, collapse = "\n"))
        quit(status = 0)   # exit 0 so the orchestrator doesn't think this killed the run
    }
    library(patchwork)

    # Build a plot per chrom (no per-panel legend; one shared legend at end)
    plots <- list()
    for (ch in chrom_list) {
        p <- tryCatch(make_plot(ch, show_legend = FALSE),
                      error = function(e) NULL)
        if (is.null(p)) next
        # Smaller text for grid tiles
        p <- p + theme(
            plot.title    = element_text(size = 9, face = "bold"),
            plot.subtitle = element_text(size = 7, color = "grey40"),
            axis.text.y   = element_text(size = 6),
            axis.text.x   = element_text(size = 6),
            axis.title.x  = element_text(size = 7)
        )
        plots[[ch]] <- p
    }

    if (length(plots) == 0L) {
        message("[BP5c-montage] grid: no plots survived filtering; writing empty stub")
        pdf(paste0(opt$`out-prefix`, "_grid.pdf"), width = 8, height = 5)
        plot.new(); title("BP_ATLAS grid  -  no chromosomes"); dev.off()
        quit(status = 0)
    }

    n <- length(plots)
    ncol_grid <- min(opt$`grid-ncol`, n)
    n_rows <- ceiling(n / ncol_grid)

    # Size the grid output
    panel_w <- opt$`width-in` / ncol_grid
    n_tracks <- nrow(atlas$all_haps)
    panel_h <- if (is.na(opt$`height-in`)) max(2.5, 0.35 * n_tracks + 1.5)
               else opt$`height-in` / n_rows
    grid_w <- opt$`width-in`
    grid_h <- panel_h * n_rows + 1   # +1 for suptitle / shared legend

    combined <- wrap_plots(plots, ncol = ncol_grid) +
        plot_annotation(
            title = sprintf("BP_ATLAS  -  anchor = %s  -  %d chromosomes",
                            opt$anchor, n),
            theme = theme(plot.title = element_text(face = "bold", size = 12))
        ) +
        plot_layout(guides = "collect") &
        theme(legend.position = "right")

    pdf_path <- paste0(opt$`out-prefix`, "_grid.pdf")
    png_path <- paste0(opt$`out-prefix`, "_grid.png")
    if (!dir.exists(dirname(pdf_path)))
        dir.create(dirname(pdf_path), recursive = TRUE)
    ggsave(pdf_path, combined, width = grid_w, height = grid_h,
           device = "pdf", useDingbats = FALSE, limitsize = FALSE)
    ggsave(png_path, combined, width = grid_w, height = grid_h,
           device = "png", dpi = opt$dpi, limitsize = FALSE)
    message("[BP5c-montage] Wrote ", pdf_path)
    message("[BP5c-montage] Wrote ", png_path)
}
