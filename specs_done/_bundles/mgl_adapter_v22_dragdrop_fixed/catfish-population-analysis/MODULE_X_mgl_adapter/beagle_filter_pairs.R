#!/usr/bin/env Rscript
###############################################################################
# beagle_filter_pairs.R
#
# Take the master all-pairs Beagle + sidecar produced by mgl10_to_beagle.R
# and apply filters to produce a PCA-ready view.
#
# Two kinds of filters:
#   ROLE filter:    keep only specific role pair labels (e.g. MAJOR_MINOR1)
#   SUPPORT filter: keep only pairs that pass numerical thresholds
#                   (pair_fraction, min_pair_allele_count, MAF, n_samples)
#
# Both can be combined.
#
# Examples:
#   # Strict biallelic baseline:
#   Rscript beagle_filter_pairs.R \
#     --beagle in.beagle.gz --sidecar in.beagle.pairs.tsv \
#     --pairs MAJOR_MINOR1 \
#     --min_pair_fraction 0.95 \
#     --min_pair_allele_count 5 \
#     --min_maf_pair 0.02 \
#     --out strict_baseline.beagle.gz
#
#   # Multi-allelic extras with reasonable support:
#   Rscript beagle_filter_pairs.R \
#     --beagle in.beagle.gz --sidecar in.beagle.pairs.tsv \
#     --pairs MAJOR_MINOR2,MINOR1_MINOR2 \
#     --min_pair_allele_count 10 \
#     --min_n_samples_with_minor 5 \
#     --out extras_supported.beagle.gz
#
#   # All pairs, support-only (no role restriction):
#   Rscript beagle_filter_pairs.R \
#     --beagle in.beagle.gz --sidecar in.beagle.pairs.tsv \
#     --min_pair_allele_count 6 --min_maf_pair 0.02 \
#     --out all_pairs_supported.beagle.gz
###############################################################################

suppressPackageStartupMessages({
  library(optparse)
  library(data.table)
})

option_list <- list(
  make_option("--beagle",  type="character", help="master all-pairs Beagle .beagle.gz"),
  make_option("--sidecar", type="character", help="master sidecar .pairs.tsv"),
  make_option("--out",     type="character", help="filtered .beagle.gz output"),
  # role filter
  make_option("--pairs",   type="character", default=NULL,
              help="comma-separated role pairs to keep (e.g. MAJOR_MINOR1,MINOR1_MINOR2). If unset, all roles allowed."),
  # support filters (all are AND-combined)
  make_option("--min_pair_fraction", type="numeric", default=0.0,
              help="min (count_a+count_b)/site_total_count [default %default]"),
  make_option("--min_pair_allele_count", type="integer", default=0L,
              help="min(count_a,count_b) ≥ this [default %default]"),
  make_option("--min_pair_count_total", type="integer", default=0L,
              help="(count_a+count_b) ≥ this [default %default]"),
  make_option("--min_maf_pair", type="numeric", default=0.0,
              help="min MAF within the pair, i.e. min(count_a,count_b)/(count_a+count_b) [default %default]"),
  make_option("--min_n_samples_with_minor", type="integer", default=0L,
              help="min number of individuals with ≥1 read of the rarer allele in the pair [default %default]"),
  make_option("--min_n_alleles_obs", type="integer", default=0L,
              help="restrict to sites with ≥ this many alleles observed (0 = no restriction) [default %default]"),
  make_option("--max_n_alleles_obs", type="integer", default=4L,
              help="restrict to sites with ≤ this many alleles observed [default %default]"),
  make_option("--write_kept_sidecar", type="logical", default=TRUE,
              help="also write a .pairs.tsv listing pairs kept [default %default]")
)
opt <- parse_args(OptionParser(option_list=option_list))

for (req in c("beagle","sidecar","out")) {
  if (is.null(opt[[req]])) stop("missing --", req, call.=FALSE)
}

# ---------------------------------------------------------------------------
# Load sidecar and decide which markers to keep
# ---------------------------------------------------------------------------
sc <- fread(opt$sidecar)
n_total <- nrow(sc)

keep <- rep(TRUE, n_total)

# Role filter
if (!is.null(opt$pairs)) {
  wanted_pairs <- strsplit(opt$pairs, ",", fixed=TRUE)[[1]]
  wanted_pairs <- trimws(wanted_pairs)
  this_pair_label <- paste(sc$role_a, sc$role_b, sep="_")
  keep <- keep & (this_pair_label %in% wanted_pairs)
  message(sprintf("[filter] role-pair filter: kept %d / %d", sum(keep), n_total))
}

# Support filters
keep <- keep & (sc$pair_fraction         >= opt$min_pair_fraction)
keep <- keep & (sc$min_pair_allele_count >= opt$min_pair_allele_count)
keep <- keep & (sc$pair_count            >= opt$min_pair_count_total)
keep <- keep & (sc$maf_pair              >= opt$min_maf_pair)

# n_samples_with_minor: take the smaller of n_samples_with_a, n_samples_with_b
n_with_minor <- pmin(sc$n_samples_with_a, sc$n_samples_with_b)
keep <- keep & (n_with_minor             >= opt$min_n_samples_with_minor)

# Allele-count restriction
if (opt$min_n_alleles_obs > 0L)
  keep <- keep & (sc$n_alleles_obs >= opt$min_n_alleles_obs)
keep <- keep & (sc$n_alleles_obs <= opt$max_n_alleles_obs)

n_kept <- sum(keep)
message(sprintf("[filter] final: kept %d / %d pairs (%.1f%%)",
                n_kept, n_total, 100*n_kept/n_total))

if (n_kept == 0L) {
  warning("[filter] no pairs survived filtering — output will be empty")
}

kept_markers <- sc$marker[keep]
kept_set <- new.env(hash=TRUE, parent=emptyenv())
for (m in kept_markers) assign(m, TRUE, envir=kept_set)

# ---------------------------------------------------------------------------
# Stream master beagle, keep header and matching marker rows
# ---------------------------------------------------------------------------
in_con  <- gzfile(opt$beagle, open="r")
out_con <- gzfile(opt$out,    open="w")

# Header
hdr <- readLines(in_con, n=1L)
writeLines(hdr, out_con)

n_written <- 0L
repeat {
  line <- readLines(in_con, n=1L)
  if (length(line) == 0L) break
  # marker is the first tab-separated field
  marker <- sub("\t.*$", "", line)
  if (exists(marker, envir=kept_set, inherits=FALSE)) {
    writeLines(line, out_con)
    n_written <- n_written + 1L
  }
}

close(in_con); close(out_con)

# Optional: kept-pairs sidecar
if (isTRUE(opt$write_kept_sidecar)) {
  kept_sidecar <- paste0(sub("\\.gz$","",opt$out), ".pairs.tsv")
  fwrite(sc[keep], kept_sidecar, sep="\t")
  message(sprintf("[filter] kept-pairs sidecar: %s", kept_sidecar))
}

message(sprintf("[filter] beagle out: %s  (%d rows)", opt$out, n_written))

if (n_written != n_kept) {
  warning(sprintf("[filter] sidecar said %d but wrote %d — some markers in sidecar not present in beagle?",
                  n_kept, n_written))
}
