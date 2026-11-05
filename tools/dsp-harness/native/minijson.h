/* Minimal JSON reader for preset files (objects, arrays, numbers, bools, strings, null). */
#ifndef MINIJSON_H
#define MINIJSON_H

#include <stddef.h>

typedef enum { MJ_NULL, MJ_BOOL, MJ_NUM, MJ_STR, MJ_ARR, MJ_OBJ } mj_type;

typedef struct mj_node {
    mj_type type;
    double num;                 /* MJ_NUM, MJ_BOOL (0/1) */
    char *str;                  /* MJ_STR */
    char *key;                  /* member name when inside an object */
    struct mj_node *child;      /* first element / member */
    struct mj_node *next;       /* sibling */
} mj_node;

mj_node *mj_parse(const char *text, char *err, size_t errlen);
mj_node *mj_parse_file(const char *path, char *err, size_t errlen);
void     mj_free(mj_node *n);

const mj_node *mj_get(const mj_node *obj, const char *key);   /* NULL if missing */
const mj_node *mj_at(const mj_node *arr, int index);
int            mj_len(const mj_node *arr);
double         mj_num(const mj_node *n, double fallback);     /* numbers and bools */
int            mj_bool(const mj_node *n, int fallback);       /* bools and numbers (!= 0) */

#endif
