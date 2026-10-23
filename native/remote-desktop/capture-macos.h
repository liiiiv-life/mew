#pragma once
#include <stdint.h>
#include <stddef.h>

#define MEW_CAPTURE_EXPORT __attribute__((visibility("default")))
typedef struct {
    double x, y;
    uint32_t visible, shape_id, width, height, hot_x, hot_y, changed;
} MewMacCursor;

MEW_CAPTURE_EXPORT uint32_t mew_capture_abi(void);
MEW_CAPTURE_EXPORT void *mew_capture_create(uint32_t display, uint32_t width, uint32_t height,
                                           double x, double y, double logical_width, double logical_height);
// 1 = changed pixels, 0 = pending/unchanged, -1 = failed. Memory belongs to caller.
MEW_CAPTURE_EXPORT int mew_capture_read(void *handle, uint8_t *pixels, size_t capacity);
MEW_CAPTURE_EXPORT int mew_capture_cursor(void *handle, MewMacCursor *cursor, uint8_t *pixels, size_t capacity);
MEW_CAPTURE_EXPORT void mew_capture_close(void *handle);
