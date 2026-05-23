#!/usr/bin/env Rscript
# ============================================================================
# STEP_BP5c_ribbons.R — single-chromosome ribbon plot of supporting haplotypes
#
# CLI wrapper over bp5_ribbon_lib.R. Reads atlas_data.json, builds one
# ribbon plot for (anchor, chrom), saves PDF + PNG.
#
# Usage:
#   Rscript STEP_BP5c_ribbons.R \
#       --atlas-json results_bpatlas/05_atlas_data/atlas_data.json \
#       --anchor     Cgar \
#       --chrom      C_gar_CM107385.1_LG27 \
#       --out-prefix results_bpatlas/05_atlas_data/figures/ribbon_Cgar_LG27 \
#       [--include-transloc] \
#       [--min-support 1] \
#       [--min-confidence low] \
#       [--min-lens-width-frac 0.005] \
#       [--width-in 14] [--height-in 6]
#
# Dependencies: jsonlite, ggplot2, data.table, optparse
# ============================================================================
suppressPackageStartupMessages({
    library(optparse)
})

# Locate the library file next to this script. Has to work whether the
# user runs `Rscript path/to/STEP_BP5c_ribbons.R` or sources it interactively.
resolve_script_dir <- function() {
    args <- commandArgs(trailingOnly = FALSE)
    file_arg <- args[grep("^--file=", args)]
    if (length(file_arg) > 0L)
        return(dirname(normalizePath(sub("^--file=", "", file_arg[1]))))
    # Fallback: cwd. Works if user runs from MODULE_BPATLAS/.
    getwd()
}
script_dir <- resolve_script_dir()
source(file.path(script_dir, "bp5_ribbon_lib.R"))

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
opt_list <- list(
    make_option("--atlas-json", type = "character", default = NULL,
                help = "Path to atlas_data.json"),
    make_option("--anchor", type = "character", default = "Cgar",
                help = "Anchor species frame [default: %default]"),
    make_option("--chrom", type = "character", default = NULL,
                help = "Chromosome name (must exist on the anchor haplotype)"),
    make_option("--out-prefix", type = "character", default = NULL,
                help = "Output prefix; .pdf and .png appended"),
    make_option("--include-transloc", action = "store_true", default = FALSE,
                help = "Also draw translocation (INTERCHROM) zones"),
    make_option("--min-support", type = "integer", default = 1,
                help = "Minimum support_pair_count [default: %default]"),
    make_option("--min-confidence", type = "character", default = "low",
                help = "Minimum confidence: low|medium|high [default: %default]"),
    make_option("--min-lens-width-frac", type = "double", default = 0.005,
                help = paste("Minimum lens width as fraction of chrom length.",
                             "Real zones are often <0.1%% of chrom so without",
                             "a floor the lens collapses [default: %default]")),
    make_option("--width-in", type = "double", default = 14,
                help = "Output width in inches [default: %default]"),
    make_option("--height-in", type = "double", default = NA,
                help = "Output height in inches [default: auto from track count]"),
    make_option("--dpi", type = "integer", default = 200,
                help = "PNG raster DPI [default: %default]")
)
opt <- parse_args(OptionParser(option_list = opt_list))

if (is.null(opt$`atlas-json`)) stop("--atlas-json is required", call. = FALSE)
if (is.null(opt$chrom))        stop("--chrom is required",      call. = FALSE)
if (is.null(opt$`out-prefix`)) stop("--out-prefix is required", call. = FALSE)

# ---------------------------------------------------------------------------
# Load and plot
# ---------------------------------------------------------------------------
message("[BP5c] Reading ", opt$`atlas-json`)
atlas <- load_atlas(opt$`atlas-json`)

p <- build_ribbon_plot(atlas, opt$anchor, opt$chrom, options = list(
    include_transloc    = opt$`include-transloc`,
    min_support         = as.integer(opt$`min-support`),
    min_confidence      = opt$`min-confidence`,
    min_lens_width_frac = opt$`min-lens-width-frac`,
    title_extra         = "(BP_ATLAS)"
))

# Auto height if not given
if (is.na(opt$`height-in`)) {
    n_tracks <- nrow(atlas$all_haps)
    opt$`height-in` <- max(4.5, 0.6 * n_tracks + 2.5)
}

save_plot(p, opt$`out-prefix`,
          width_in  = opt$`width-in`,
          height_in = opt$`height-in`,
          dpi       = opt$dpi)
