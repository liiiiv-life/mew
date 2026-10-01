#pragma once
#include <stdint.h>
#include <stddef.h>
#define MEW_GPU_EXPORT __attribute__((visibility("default")))
#ifdef __cplusplus
extern "C" {
#endif
typedef struct { int32_t id, x, y, width, height, reserved; } MewGpuScreen;
typedef struct { int32_t length, width, height, key; int64_t timestamp; } MewGpuFrame;
MEW_GPU_EXPORT int mew_gpu_abi(void);
MEW_GPU_EXPORT void *mew_gpu_create(void);
MEW_GPU_EXPORT int mew_gpu_screens(void *, MewGpuScreen *, int);
MEW_GPU_EXPORT int mew_gpu_source(void *, int, int, int, int);
MEW_GPU_EXPORT int mew_gpu_start(void *, int, int, int, int, int, int, uint32_t);
MEW_GPU_EXPORT int mew_gpu_current(void *, MewGpuScreen *);
MEW_GPU_EXPORT int mew_gpu_poll(void *, uint8_t *, int, MewGpuFrame *);
MEW_GPU_EXPORT void mew_gpu_keyframe(void *);
MEW_GPU_EXPORT void mew_gpu_bitrate(void *, int);
MEW_GPU_EXPORT int mew_gpu_stop(void *);
MEW_GPU_EXPORT void mew_gpu_destroy(void *);
MEW_GPU_EXPORT int mew_gpu_allowed(void);
MEW_GPU_EXPORT const char *mew_gpu_error(void *);
#ifdef __cplusplus
}
#endif
