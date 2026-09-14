#ifndef DS4_CED_PROFILE_H
#define DS4_CED_PROFILE_H
#include <stdio.h>
#include <stdlib.h>
#include <nvToolsExt.h>
static inline void ced_pop(int *active) { if (*active) nvtxRangePop(); }
#define CED_RANGE(...) \
    int ced_active __attribute__((cleanup(ced_pop))) = getenv("DS4_CED_PROFILE") != NULL; \
    char ced_label[192]; \
    if (ced_active) { snprintf(ced_label, sizeof(ced_label), __VA_ARGS__); nvtxRangePushA(ced_label); }
#endif
