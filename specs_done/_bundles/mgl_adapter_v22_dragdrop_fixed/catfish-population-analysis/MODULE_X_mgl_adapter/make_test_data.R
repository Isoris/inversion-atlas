#!/usr/bin/env Rscript
# make_test_data.R: build synthetic GLF10 inputs to validate adapter+filter.
#
# 5 individuals (so we can have varied genotypes), 4 sites:
#   site 1: clean biallelic A/G — should sail through any filter
#   site 2: clean tri-allelic A/C/G — all 3 pairs should be well-supported
#   site 3: WEAK tri-allelic — one allele has only 2 reads out of 100
#           ⇒ MAJOR_MINOR1 is well-supported, MINOR1_MINOR2 and MAJOR_MINOR2
#             should fail support filters
#   site 4: quad-allelic with one really weak allele (T = 1 read)

suppressPackageStartupMessages(library(data.table))

ALLELE_CHAR <- c("A","C","G","T")
GT_LUT <- matrix(NA_integer_, 4, 4)
GT_LUT[1,1]<-1; GT_LUT[1,2]<-GT_LUT[2,1]<-2; GT_LUT[1,3]<-GT_LUT[3,1]<-3; GT_LUT[1,4]<-GT_LUT[4,1]<-4
GT_LUT[2,2]<-5; GT_LUT[2,3]<-GT_LUT[3,2]<-6; GT_LUT[2,4]<-GT_LUT[4,2]<-7
GT_LUT[3,3]<-8; GT_LUT[3,4]<-GT_LUT[4,3]<-9; GT_LUT[4,4]<-10

# log-likelihood vector with confidence p for true GT
make_gl <- function(a, b, p=0.95) {
  v <- rep(log((1-p)/9), 10)
  v[GT_LUT[a+1, b+1]] <- log(p)
  v
}

# All sites have 5 individuals. We define genotypes + per-ind A,C,G,T counts.
# (depths chosen so totals match the "weak pair" scenarios.)

sites <- list(
  # Site 1: clean biallelic A/G, 5 inds, ~10x each — totals A=25, G=25
  list(chrom="C_gar_LG28", pos=1000L,
       gts = list(c(0,0), c(0,2), c(2,2), c(0,2), c(0,0)),
       counts = list(c(10,0,0,0), c(5,0,5,0), c(0,0,10,0), c(5,0,5,0), c(10,0,0,0))),

  # Site 2: clean tri-allelic A/C/G — all pairs well-supported
  # Genotypes: A/A, A/C, C/G, G/G, A/G  -> totals A=20, C=10, G=20
  list(chrom="C_gar_LG28", pos=2000L,
       gts = list(c(0,0), c(0,1), c(1,2), c(2,2), c(0,2)),
       counts = list(c(10,0,0,0), c(5,5,0,0), c(0,5,5,0), c(0,0,10,0), c(5,0,5,0))),

  # Site 3: WEAK tri-allelic.
  # Genotypes: A/A, A/A, A/G, G/G, A/G — primarily biallelic A/G
  # Plus one ind has 2 spurious C reads in addition to A/A — total C only = 2
  # totals: A=20+8=28 wait let's be precise
  # ind1 A/A: 10A
  # ind2 A/A: 10A + 2C  (← the weak C)
  # ind3 A/G: 5A + 5G
  # ind4 G/G: 10G
  # ind5 A/G: 5A + 5G
  # totals: A=30, G=20, C=2 → MAJOR=A MINOR1=G MINOR2=C
  # MAJOR_MINOR1 (A/G):   pair_count=50, OK
  # MAJOR_MINOR2 (A/C):   pair_count=32, but min_pair_allele_count=2 → weak
  # MINOR1_MINOR2 (G/C):  pair_count=22, min_pair_allele_count=2 → weak
  list(chrom="C_gar_LG28", pos=3000L,
       gts = list(c(0,0), c(0,0), c(0,2), c(2,2), c(0,2)),
       counts = list(c(10,0,0,0), c(10,2,0,0), c(5,0,5,0), c(0,0,10,0), c(5,0,5,0))),

  # Site 4: quad-allelic with very weak T.
  # Mostly A/G again, plus one ind has 1 T read and one ind has 3 C reads
  # ind1 A/A: 10A + 1T
  # ind2 A/G: 5A + 5G
  # ind3 G/G: 10G
  # ind4 A/G: 5A + 5G + 3C
  # ind5 A/A: 10A
  # totals: A=30, G=20, C=3, T=1
  # MAJOR=A, MINOR1=G, MINOR2=C, MINOR3=T
  list(chrom="C_gar_LG28", pos=4000L,
       gts = list(c(0,0), c(0,2), c(2,2), c(0,2), c(0,0)),
       counts = list(c(10,0,0,1), c(5,0,5,0), c(0,0,10,0), c(5,3,5,0), c(10,0,0,0)))
)

n_ind <- 5
samples <- paste0("S", seq_len(n_ind))
writeLines(paste0(samples, ".bam"), "test.bamlist")

# Write GLF10 binary
glf_con <- gzfile("test.glf.gz", "wb")
for (s in sites) {
  for (gt in s$gts) {
    v <- make_gl(gt[1], gt[2])
    writeBin(v, glf_con, size=8L, endian="little")
  }
}
close(glf_con)

# Write pos file
pos_dt <- data.table(
  chrom = sapply(sites, `[[`, "chrom"),
  pos   = sapply(sites, `[[`, "pos"),
  major = c("A","A","A","A"),
  minor = c("G","G","G","G")
)
fwrite(pos_dt, "test.glf.pos.gz", sep="\t", col.names=FALSE, compress="gzip")

# Write counts file
hdr <- unlist(lapply(seq_len(n_ind), function(i) paste0("ind",i-1,c("A","C","G","T"))))
counts_rows <- list()
for (s in sites) {
  row <- integer(4*n_ind)
  for (i in seq_along(s$counts)) {
    row[((i-1)*4 + 1):((i-1)*4 + 4)] <- s$counts[[i]]
  }
  counts_rows[[length(counts_rows)+1]] <- row
}
counts_dt <- as.data.table(do.call(rbind, counts_rows))
setnames(counts_dt, hdr)
fwrite(counts_dt, "test.counts.gz", sep="\t", compress="gzip")

# Print expected support metrics
cat("\n=== Expected per-site, per-pair support ===\n")
for (k in seq_along(sites)) {
  s <- sites[[k]]
  totals <- integer(4)
  for (c in s$counts) totals <- totals + c
  passing <- which(totals > 0) - 1
  ord <- passing[order(totals[passing+1], decreasing=TRUE)]
  roles <- ALLELE_CHAR[ord+1]
  cat(sprintf("  Site %d (pos %d): n_alleles=%d  totals=[A=%d C=%d G=%d T=%d]\n",
              k, s$pos, length(ord), totals[1], totals[2], totals[3], totals[4]))
  for (i in 1:(length(ord)-1)) for (j in (i+1):length(ord)) {
    a <- ord[i]; b <- ord[j]
    site_total <- sum(totals[ord+1])
    pair_count <- totals[a+1] + totals[b+1]
    pair_frac  <- pair_count / site_total
    min_pac    <- min(totals[a+1], totals[b+1])
    maf_pair   <- min_pac / pair_count
    cat(sprintf("    %s_%s_%s_%s: pair_count=%d  pair_fraction=%.3f  min_pair_allele_count=%d  maf_pair=%.3f\n",
                c("MAJOR","MINOR1","MINOR2","MINOR3")[i],
                c("MAJOR","MINOR1","MINOR2","MINOR3")[j],
                ALLELE_CHAR[a+1], ALLELE_CHAR[b+1],
                pair_count, pair_frac, min_pac, maf_pair))
  }
}
cat("\n")
