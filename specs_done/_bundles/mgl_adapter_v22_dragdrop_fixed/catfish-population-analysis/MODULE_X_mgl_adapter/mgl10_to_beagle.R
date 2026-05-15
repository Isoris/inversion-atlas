#!/usr/bin/env Rscript
###############################################################################
# mgl10_to_beagle.R
#
# Adapter: ANGSD GLF10 (binary, 10 GLs per ind per site) + dumpCounts
#       -> Beagle file with one row per (site, allele-pair)   [MASTER OUTPUT]
#       -> sidecar with FULL support metadata per pair        [MASTER METADATA]
#
# Convention (cohort-count-based ranks):
#   MAJOR  = allele with highest total count across cohort at this site
#   MINOR1 = 2nd highest
#   MINOR2 = 3rd highest  (tri+ allelic sites only)
#   MINOR3 = 4th highest  (quad-allelic sites only)
#
# Pair labels:
#   biallelic:    MAJOR_MINOR1
#   tri:          MAJOR_MINOR1, MAJOR_MINOR2, MINOR1_MINOR2
#   quad:         all 6 pairs of MAJOR/MINOR1/MINOR2/MINOR3
#
# Marker naming:
#   <chrom>_<pos>_<ROLE_a>_<ROLE_b>_<allele_a>_<allele_b>
#
# THIS ADAPTER DOES NOT FILTER WEAK PAIRS.
# It emits every pair where both alleles have ≥ min_allele_count reads in the
# cohort (default 1, i.e. observed at all). Per-pair support metadata is
# written to the sidecar; downstream filters in beagle_filter_pairs.sh apply
# real thresholds to produce PCA-ready views.
#
# Usage:
#   Rscript mgl10_to_beagle.R \
#     --glf      interval.glf.gz \
#     --pos      interval.glf.pos.gz \
#     --counts   interval.counts.gz \
#     --bamlist  bamlist.txt \
#     --out      interval.beagle.gz \
#     [--min_allele_count 1] [--gl_log_base natural|log10]
###############################################################################

suppressPackageStartupMessages({
  library(optparse)
  library(data.table)
})

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
option_list <- list(
  make_option("--glf",      type="character", help="ANGSD .glf.gz (binary)"),
  make_option("--pos",      type="character", help="ANGSD .glf.pos.gz"),
  make_option("--counts",   type="character", help="ANGSD .counts.gz from -dumpCounts 3"),
  make_option("--mafs",     type="character", default=NULL, help="(optional) ANGSD .mafs.gz"),
  make_option("--bamlist",  type="character", help="bamlist used in ANGSD"),
  make_option("--out",      type="character", help="output .beagle.gz"),
  make_option("--min_allele_count", type="integer", default=1L,
              help="minimum cohort read count for an allele to be considered observed [default %default]"),
  make_option("--gl_log_base", type="character", default="natural",
              help="ANGSD GL base: 'natural' or 'log10' [default %default]")
)
opt <- parse_args(OptionParser(option_list=option_list))

for (req in c("glf","pos","counts","bamlist","out")) {
  if (is.null(opt[[req]])) stop("missing --", req, call.=FALSE)
}

# ---------------------------------------------------------------------------
# Constants and lookups
# ---------------------------------------------------------------------------
ALLELE_CHAR <- c("A","C","G","T")

# Genotype index (1-based) in ANGSD's 10-vector, alphabetical order:
#   0:AA 1:AC 2:AG 3:AT 4:CC 5:CG 6:CT 7:GG 8:GT 9:TT
GT_LUT <- matrix(NA_integer_, 4, 4)
GT_LUT[1,1] <- 1L
GT_LUT[1,2] <- GT_LUT[2,1] <- 2L
GT_LUT[1,3] <- GT_LUT[3,1] <- 3L
GT_LUT[1,4] <- GT_LUT[4,1] <- 4L
GT_LUT[2,2] <- 5L
GT_LUT[2,3] <- GT_LUT[3,2] <- 6L
GT_LUT[2,4] <- GT_LUT[4,2] <- 7L
GT_LUT[3,3] <- 8L
GT_LUT[3,4] <- GT_LUT[4,3] <- 9L
GT_LUT[4,4] <- 10L

ROLE_NAME <- c("MAJOR","MINOR1","MINOR2","MINOR3")
pair_label <- function(rank_a, rank_b) {
  paste(ROLE_NAME[rank_a], ROLE_NAME[rank_b], sep="_")
}

LL_SCALE <- if (opt$gl_log_base == "log10") log(10) else 1.0

# ---------------------------------------------------------------------------
# Read inputs
# ---------------------------------------------------------------------------
bamlist <- readLines(opt$bamlist)
bamlist <- bamlist[nzchar(trimws(bamlist))]
samples <- sub("\\.[^.]+$", "", basename(bamlist))
n_ind   <- length(samples)
message(sprintf("[mgl10_to_beagle] samples: n=%d", n_ind))

pos_dt <- fread(opt$pos, header=FALSE,
                col.names=c("chrom","pos","major_angsd","minor_angsd"))
n_sites <- nrow(pos_dt)
message(sprintf("[mgl10_to_beagle] sites: n=%d", n_sites))

counts_dt <- fread(opt$counts, header=TRUE)
stopifnot(nrow(counts_dt) == n_sites)
stopifnot(ncol(counts_dt) == 4L * n_ind)
counts_mat <- as.matrix(counts_dt)
storage.mode(counts_mat) <- "integer"

# Per-site cohort allele totals (n_sites × 4)
allele_totals <- matrix(0L, nrow=n_sites, ncol=4L,
                        dimnames=list(NULL, ALLELE_CHAR))
for (a in 0:3) {
  cols_for_allele <- seq.int(a + 1L, by = 4L, length.out = n_ind)
  allele_totals[, a + 1L] <- rowSums(counts_mat[, cols_for_allele, drop=FALSE])
}

# Per-site, per-allele: number of individuals with ≥1 read of that allele
samples_with_allele <- matrix(0L, nrow=n_sites, ncol=4L,
                              dimnames=list(NULL, ALLELE_CHAR))
for (a in 0:3) {
  cols_for_allele <- seq.int(a + 1L, by = 4L, length.out = n_ind)
  samples_with_allele[, a + 1L] <- rowSums(counts_mat[, cols_for_allele, drop=FALSE] > 0L)
}

message(sprintf("[mgl10_to_beagle] median total depth per site: %.0f",
                median(rowSums(allele_totals))))

# ---------------------------------------------------------------------------
# Per-site role assignment (no MAC/MAF filtering — emit everything observed)
# ---------------------------------------------------------------------------
min_obs <- as.integer(opt$min_allele_count)

assign_roles <- function(totals_row) {
  passing <- which(totals_row >= min_obs) - 1L
  if (length(passing) < 2L) return(NULL)
  passing[order(totals_row[passing + 1L], decreasing = TRUE)]
}

# ---------------------------------------------------------------------------
# Open IO
# ---------------------------------------------------------------------------
glf_con    <- gzfile(opt$glf, open="rb")
n_per_site <- 10L * n_ind

out_con <- gzfile(opt$out, open="w")
hdr <- c("marker","allele1","allele2",
         paste0(rep(samples, each=3L),
                rep(c("_AA","_Aa","_aa"), times=n_ind)))
writeLines(paste(hdr, collapse="\t"), out_con)

# Sidecar (master metadata, one row per emitted Beagle row)
sidecar_path <- paste0(sub("\\.gz$", "", opt$out), ".pairs.tsv")
sidecar_con  <- file(sidecar_path, open="w")
sidecar_hdr  <- c(
  "marker", "chrom", "pos",
  "n_alleles_obs", "site_total_count",
  "role_a", "role_b", "allele_a", "allele_b",
  "count_a", "count_b", "pair_count",
  "pair_fraction",            # pair_count / site_total_count
  "min_pair_allele_count",    # min(count_a, count_b)
  "n_samples_with_a", "n_samples_with_b", "n_samples_with_either",
  "maf_pair"                  # min(count_a,count_b) / pair_count
)
writeLines(paste(sidecar_hdr, collapse="\t"), sidecar_con)

# ---------------------------------------------------------------------------
# Stream
# ---------------------------------------------------------------------------
n_emitted_sites <- 0L
n_emitted_rows  <- 0L
n_skipped_sites <- 0L

t0 <- Sys.time()
log_every <- max(1L, n_sites %/% 20L)

for (s in seq_len(n_sites)) {
  raw <- readBin(glf_con, what="double", n=n_per_site, size=8L, endian="little")
  if (length(raw) != n_per_site) {
    stop(sprintf("[mgl10_to_beagle] short read at site %d: got %d, expected %d",
                 s, length(raw), n_per_site))
  }
  L10 <- matrix(raw, nrow=10L, ncol=n_ind)
  if (LL_SCALE != 1.0) L10 <- L10 * LL_SCALE   # log10 -> natural log

  roles <- assign_roles(allele_totals[s, ])
  if (is.null(roles)) {
    n_skipped_sites <- n_skipped_sites + 1L
    next
  }
  n_alleles  <- length(roles)
  site_total <- sum(allele_totals[s, roles + 1L])
  pairs_to_emit <- combn(seq_len(n_alleles), 2L, simplify=FALSE)

  for (rk in pairs_to_emit) {
    rk_a <- rk[1]; rk_b <- rk[2]
    a    <- roles[rk_a]
    b    <- roles[rk_b]

    ll_aa <- L10[GT_LUT[a + 1L, a + 1L], ]
    ll_ab <- L10[GT_LUT[a + 1L, b + 1L], ]
    ll_bb <- L10[GT_LUT[b + 1L, b + 1L], ]

    M  <- pmax(ll_aa, ll_ab, ll_bb)
    is_flat <- !is.finite(M)
    e_aa <- exp(ll_aa - M); e_aa[is_flat] <- 1
    e_ab <- exp(ll_ab - M); e_ab[is_flat] <- 1
    e_bb <- exp(ll_bb - M); e_bb[is_flat] <- 1
    Z    <- e_aa + e_ab + e_bb
    p_aa <- e_aa / Z
    p_ab <- e_ab / Z
    p_bb <- e_bb / Z

    marker <- sprintf("%s_%d_%s_%s_%s",
                      pos_dt$chrom[s], pos_dt$pos[s],
                      pair_label(rk_a, rk_b),
                      ALLELE_CHAR[a + 1L], ALLELE_CHAR[b + 1L])

    gls  <- sprintf("%.6f", c(rbind(p_aa, p_ab, p_bb)))
    line <- paste(c(marker, as.character(a), as.character(b), gls), collapse="\t")
    writeLines(line, out_con)

    # Support metadata
    count_a        <- allele_totals[s, a + 1L]
    count_b        <- allele_totals[s, b + 1L]
    pair_count     <- count_a + count_b
    pair_fraction  <- if (site_total > 0L) pair_count / site_total else NA_real_
    min_pair_count <- min(count_a, count_b)
    maf_pair       <- if (pair_count > 0L) min_pair_count / pair_count else NA_real_

    n_with_a <- samples_with_allele[s, a + 1L]
    n_with_b <- samples_with_allele[s, b + 1L]
    cols_a <- seq.int(a + 1L, by = 4L, length.out = n_ind)
    cols_b <- seq.int(b + 1L, by = 4L, length.out = n_ind)
    n_with_either <- sum((counts_mat[s, cols_a] > 0L) | (counts_mat[s, cols_b] > 0L))

    sidecar_row <- c(
      marker, pos_dt$chrom[s], pos_dt$pos[s],
      n_alleles, site_total,
      ROLE_NAME[rk_a], ROLE_NAME[rk_b],
      ALLELE_CHAR[a+1L], ALLELE_CHAR[b+1L],
      count_a, count_b, pair_count,
      sprintf("%.6f", pair_fraction),
      min_pair_count,
      n_with_a, n_with_b, n_with_either,
      sprintf("%.6f", maf_pair)
    )
    writeLines(paste(sidecar_row, collapse="\t"), sidecar_con)

    n_emitted_rows <- n_emitted_rows + 1L
  }
  n_emitted_sites <- n_emitted_sites + 1L

  if (s %% log_every == 0L) {
    dt <- as.numeric(Sys.time() - t0, units="secs")
    rate <- s / max(dt, 1e-9)
    eta  <- (n_sites - s) / max(rate, 1e-9)
    message(sprintf("[mgl10_to_beagle] site %d/%d (%.0f%%)  rows=%d  rate=%.0f/s  eta=%.0fs",
                    s, n_sites, 100*s/n_sites, n_emitted_rows, rate, eta))
  }
}

message(sprintf("[mgl10_to_beagle] done: emitted %d sites, %d Beagle rows; skipped %d sites with <2 observed alleles",
                n_emitted_sites, n_emitted_rows, n_skipped_sites))

close(out_con); close(glf_con); close(sidecar_con)

message(sprintf("[mgl10_to_beagle] beagle:  %s", opt$out))
message(sprintf("[mgl10_to_beagle] sidecar: %s", sidecar_path))
message(sprintf("[mgl10_to_beagle] NOTE: master output is unfiltered. Apply support thresholds via beagle_filter_pairs.sh."))
