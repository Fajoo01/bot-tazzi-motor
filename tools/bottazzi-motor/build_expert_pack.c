#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define NL 40u
#define NE 384u
#define ALIGN 4096ull
#define HEADER 4096ull
#define RECORD_BYTES 9953280ull

struct layer { uint64_t g, u, d, gb, ub, db; };
static struct layer layers[NL];
static int src_fd = -1, dst_fd = -1;
static uint64_t src_size, src_mtime_ns;
static atomic_uint next_job, done_jobs;
static atomic_int failed;

static uint64_t round_up(uint64_t x) { return (x + ALIGN - 1) & ~(ALIGN - 1); }

static int pread_full(int fd, void *ptr, uint64_t bytes, uint64_t off) {
    char *p = ptr;
    while (bytes) {
        ssize_t n = pread(fd, p, (size_t)bytes, (off_t)off);
        if (n < 0) { if (errno == EINTR) continue; return 0; }
        if (n == 0) return 0;
        p += n; off += (uint64_t)n; bytes -= (uint64_t)n;
    }
    return 1;
}

static int pwrite_full(int fd, const void *ptr, uint64_t bytes, uint64_t off) {
    const char *p = ptr;
    while (bytes) {
        ssize_t n = pwrite(fd, p, (size_t)bytes, (off_t)off);
        if (n < 0) { if (errno == EINTR) continue; return 0; }
        p += n; off += (uint64_t)n; bytes -= (uint64_t)n;
    }
    return 1;
}

static int read_slice(void *scratch, uint64_t cap, uint64_t off,
                      uint64_t bytes, void *out) {
    uint64_t aligned = off & ~(ALIGN - 1);
    uint64_t delta = off - aligned;
    uint64_t read_bytes = round_up(delta + bytes);
    if (read_bytes > cap || aligned > src_size || read_bytes > src_size - aligned)
        return 0;
    if (!pread_full(src_fd, scratch, read_bytes, aligned)) return 0;
    memcpy(out, (char *)scratch + delta, (size_t)bytes);
    return 1;
}

static void *worker(void *unused) {
    (void)unused;
    const uint64_t scratch_bytes = round_up(3870720ull + ALIGN);
    void *scratch = NULL, *record = NULL;
    if (posix_memalign(&scratch, ALIGN, (size_t)scratch_bytes) != 0 ||
        posix_memalign(&record, ALIGN, (size_t)RECORD_BYTES) != 0) {
        free(scratch); free(record); atomic_store(&failed, 1); return NULL;
    }
    while (!atomic_load(&failed)) {
        unsigned job = atomic_fetch_add(&next_job, 1);
        if (job >= NL * NE) break;
        unsigned layer = job / NE, expert = job % NE;
        struct layer *l = &layers[layer];
        char *r = record;
        if (!read_slice(scratch, scratch_bytes, l->g + (uint64_t)expert * l->gb, l->gb, r) ||
            !read_slice(scratch, scratch_bytes, l->u + (uint64_t)expert * l->ub, l->ub, r + l->gb) ||
            !read_slice(scratch, scratch_bytes, l->d + (uint64_t)expert * l->db, l->db, r + l->gb + l->ub) ||
            !pwrite_full(dst_fd, r, RECORD_BYTES, HEADER + (uint64_t)job * RECORD_BYTES)) {
            atomic_store(&failed, 1); break;
        }
        unsigned done = atomic_fetch_add(&done_jobs, 1) + 1;
        if (done % NE == 0)
            fprintf(stderr, "packed %.1f%% %.2f GiB\n",
                    100.0 * done / (NL * NE),
                    (double)done * RECORD_BYTES / 1073741824.0);
    }
    free(record); free(scratch); return NULL;
}

int main(int argc, char **argv) {
    if (argc != 5) {
        fprintf(stderr, "usage: %s src manifest dst threads\n", argv[0]);
        return 2;
    }
    FILE *manifest = fopen(argv[2], "r");
    if (!manifest) { perror("manifest"); return 3; }
    for (unsigned i = 0; i < NL; i++) {
        unsigned layer;
        if (fscanf(manifest, "%u %" SCNu64 " %" SCNu64 " %" SCNu64
                   " %" SCNu64 " %" SCNu64 " %" SCNu64,
                   &layer, &layers[i].g, &layers[i].u, &layers[i].d,
                   &layers[i].gb, &layers[i].ub, &layers[i].db) != 7 || layer != i) {
            fclose(manifest); fprintf(stderr, "invalid manifest at layer %u\n", i); return 4;
        }
    }
    fclose(manifest);
    struct stat st;
    if (stat(argv[1], &st) != 0) { perror("stat source"); return 5; }
    src_size = (uint64_t)st.st_size;
    src_mtime_ns = (uint64_t)st.st_mtim.tv_sec * 1000000000ull + (uint64_t)st.st_mtim.tv_nsec;
    src_fd = open(argv[1], O_RDONLY | O_DIRECT);
    dst_fd = open(argv[3], O_CREAT | O_TRUNC | O_RDWR | O_DIRECT, 0644);
    if (src_fd < 0 || dst_fd < 0) { perror("open"); return 6; }
    uint64_t total = HEADER + (uint64_t)NL * NE * RECORD_BYTES;
    int falloc_rc = posix_fallocate(dst_fd, 0, (off_t)total);
    if (falloc_rc != 0) { errno = falloc_rc; perror("fallocate"); return 7; }
    int threads = atoi(argv[4]);
    if (threads < 1) threads = 1;
    if (threads > 8) threads = 8;
    pthread_t pool[8];
    for (int i = 0; i < threads; i++) pthread_create(&pool[i], NULL, worker, NULL);
    for (int i = 0; i < threads; i++) pthread_join(pool[i], NULL);
    if (atomic_load(&failed)) { fprintf(stderr, "pack failed\n"); return 8; }
    void *header = NULL;
    if (posix_memalign(&header, ALIGN, HEADER) != 0 || !header) return 9;
    memset(header, 0, HEADER);
    memcpy(header, "BTZMTR01", 8);
    uint32_t *u32 = header;
    u32[2] = 1; u32[3] = NL; u32[4] = NE; u32[5] = HEADER;
    uint64_t *u64 = (uint64_t *)((char *)header + 24);
    u64[0] = 3041280; u64[1] = 3041280; u64[2] = 3870720;
    u64[3] = RECORD_BYTES; u64[4] = src_size; u64[5] = src_mtime_ns; u64[6] = 1;
    if (!pwrite_full(dst_fd, header, HEADER, 0)) { perror("header"); return 10; }
    free(header);
    if (fdatasync(dst_fd) != 0) { perror("fdatasync"); return 11; }
    close(dst_fd); close(src_fd);
    fprintf(stderr, "PACK_COMPLETE bytes=%" PRIu64 "\n", total);
    return 0;
}
