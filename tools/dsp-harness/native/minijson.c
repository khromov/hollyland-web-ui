#include "minijson.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { const char *p; char *err; size_t errlen; } mj_ctx;

static void mj_fail(mj_ctx *c, const char *msg) {
    if (c->err && !c->err[0]) snprintf(c->err, c->errlen, "%s near '%.20s'", msg, c->p);
}

static void skip_ws(mj_ctx *c) { while (*c->p && isspace((unsigned char)*c->p)) c->p++; }

static mj_node *new_node(mj_type t) {
    mj_node *n = calloc(1, sizeof *n);
    if (n) n->type = t;
    return n;
}

static mj_node *parse_value(mj_ctx *c);

static char *parse_string(mj_ctx *c) {
    if (*c->p != '"') { mj_fail(c, "expected string"); return NULL; }
    c->p++;
    size_t cap = 32, len = 0;
    char *s = malloc(cap);
    if (!s) return NULL;
    while (*c->p && *c->p != '"') {
        char ch = *c->p++;
        if (ch == '\\') {
            char e = *c->p++;
            switch (e) {
            case 'n': ch = '\n'; break;
            case 't': ch = '\t'; break;
            case 'r': ch = '\r'; break;
            case 'b': ch = '\b'; break;
            case 'f': ch = '\f'; break;
            case 'u': {           /* keep it simple: emit '?' for escapes, presets do not use them */
                for (int i = 0; i < 4 && *c->p; i++) c->p++;
                ch = '?';
                break;
            }
            default: ch = e; break;
            }
        }
        if (len + 2 > cap) { cap *= 2; char *t = realloc(s, cap); if (!t) { free(s); return NULL; } s = t; }
        s[len++] = ch;
    }
    if (*c->p != '"') { mj_fail(c, "unterminated string"); free(s); return NULL; }
    c->p++;
    s[len] = 0;
    return s;
}

static mj_node *parse_container(mj_ctx *c, int is_obj) {
    mj_node *n = new_node(is_obj ? MJ_OBJ : MJ_ARR), *tail = NULL;
    if (!n) return NULL;
    c->p++;
    skip_ws(c);
    if (*c->p == (is_obj ? '}' : ']')) { c->p++; return n; }
    for (;;) {
        char *key = NULL;
        skip_ws(c);
        if (is_obj) {
            key = parse_string(c);
            if (!key) { mj_free(n); return NULL; }
            skip_ws(c);
            if (*c->p != ':') { mj_fail(c, "expected ':'"); free(key); mj_free(n); return NULL; }
            c->p++;
        }
        mj_node *v = parse_value(c);
        if (!v) { free(key); mj_free(n); return NULL; }
        v->key = key;
        if (tail) tail->next = v; else n->child = v;
        tail = v;
        skip_ws(c);
        if (*c->p == ',') { c->p++; continue; }
        if (*c->p == (is_obj ? '}' : ']')) { c->p++; return n; }
        mj_fail(c, "expected ',' or closing bracket");
        mj_free(n);
        return NULL;
    }
}

static mj_node *parse_value(mj_ctx *c) {
    skip_ws(c);
    if (*c->p == '{') return parse_container(c, 1);
    if (*c->p == '[') return parse_container(c, 0);
    if (*c->p == '"') {
        mj_node *n = new_node(MJ_STR);
        if (n && !(n->str = parse_string(c))) { free(n); return NULL; }
        return n;
    }
    if (!strncmp(c->p, "true", 4))  { c->p += 4; mj_node *n = new_node(MJ_BOOL); if (n) n->num = 1; return n; }
    if (!strncmp(c->p, "false", 5)) { c->p += 5; return new_node(MJ_BOOL); }
    if (!strncmp(c->p, "null", 4))  { c->p += 4; return new_node(MJ_NULL); }
    char *end = NULL;
    double v = strtod(c->p, &end);
    if (end == c->p) { mj_fail(c, "unexpected token"); return NULL; }
    c->p = end;
    mj_node *n = new_node(MJ_NUM);
    if (n) n->num = v;
    return n;
}

mj_node *mj_parse(const char *text, char *err, size_t errlen) {
    mj_ctx c = { text, err, errlen };
    if (err && errlen) err[0] = 0;
    if ((unsigned char)c.p[0] == 0xEF && (unsigned char)c.p[1] == 0xBB && (unsigned char)c.p[2] == 0xBF) c.p += 3;
    mj_node *n = parse_value(&c);
    if (n) { skip_ws(&c); if (*c.p) { mj_fail(&c, "trailing data"); mj_free(n); return NULL; } }
    return n;
}

mj_node *mj_parse_file(const char *path, char *err, size_t errlen) {
    FILE *f = fopen(path, "rb");
    if (!f) { if (err) snprintf(err, errlen, "cannot open %s", path); return NULL; }
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc((size_t)sz + 1);
    if (!buf) { fclose(f); return NULL; }
    size_t got = fread(buf, 1, (size_t)sz, f);
    fclose(f);
    buf[got] = 0;
    mj_node *n = mj_parse(buf, err, errlen);
    free(buf);
    return n;
}

void mj_free(mj_node *n) {
    while (n) {
        mj_node *next = n->next;
        mj_free(n->child);
        free(n->str);
        free(n->key);
        free(n);
        n = next;
    }
}

const mj_node *mj_get(const mj_node *obj, const char *key) {
    if (!obj || obj->type != MJ_OBJ) return NULL;
    for (const mj_node *m = obj->child; m; m = m->next)
        if (m->key && !strcmp(m->key, key)) return m;
    return NULL;
}

const mj_node *mj_at(const mj_node *arr, int index) {
    if (!arr || arr->type != MJ_ARR) return NULL;
    const mj_node *m = arr->child;
    while (m && index-- > 0) m = m->next;
    return m;
}

int mj_len(const mj_node *arr) {
    int n = 0;
    if (arr && arr->type == MJ_ARR) for (const mj_node *m = arr->child; m; m = m->next) n++;
    return n;
}

double mj_num(const mj_node *n, double fallback) {
    if (n && (n->type == MJ_NUM || n->type == MJ_BOOL)) return n->num;
    return fallback;
}

int mj_bool(const mj_node *n, int fallback) {
    if (n && (n->type == MJ_NUM || n->type == MJ_BOOL)) return n->num != 0;
    return fallback;
}
