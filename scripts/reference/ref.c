/*
 * Independent reference values produced by the C compiler / hardware:
 *   - binary64 -> binary32 and binary64 -> binary16 (_Float16) conversions
 *     under each IEEE rounding direction (fesetround),
 *   - binary32 additions and multiplications under each rounding direction,
 *   - xoshiro128** 1.1 output (reference algorithm by Blackman & Vigna,
 *     https://prng.di.unimi.it/xoshiro128starstar.c) seeded via SplitMix32.
 *
 * Input:  lines "conv <hex64>" | "add32 <hex64> <hex64>" | "mul32 <hex64> <hex64>" | "rng <seed> <count>"
 * Output: one line per input with hex results for modes [RNE, RTZ, RU, RD].
 * Build:  gcc -O0 -frounding-math -o ref ref.c -lm
 */
#include <fenv.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#pragma STDC FENV_ACCESS ON

static const int modes[4] = {FE_TONEAREST, FE_TOWARDZERO, FE_UPWARD, FE_DOWNWARD};

static double from_hex(const char *s) {
  uint64_t u; double d;
  sscanf(s, "%" SCNx64, &u);
  memcpy(&d, &u, 8);
  return d;
}
static uint64_t bits64(double d) { uint64_t u; memcpy(&u, &d, 8); return u; }
static uint32_t bits32(float f) { uint32_t u; memcpy(&u, &f, 4); return u; }
static uint16_t bits16(_Float16 h) { uint16_t u; memcpy(&u, &h, 2); return u; }

static volatile double vd;
static volatile float vf, vf2;

static uint32_t s[4];
static uint32_t rotl(const uint32_t x, int k) { return (x << k) | (x >> (32 - k)); }
static uint32_t next(void) {
  const uint32_t result = rotl(s[1] * 5, 7) * 9;
  const uint32_t t = s[1] << 9;
  s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
  s[2] ^= t;
  s[3] = rotl(s[3], 11);
  return result;
}
static uint32_t splitmix32(uint32_t *st) {
  *st += 0x9e3779b9u;
  uint32_t z = *st;
  z = (z ^ (z >> 16)) * 0x85ebca6bu;
  z = (z ^ (z >> 13)) * 0xc2b2ae35u;
  return z ^ (z >> 16);
}

int main(void) {
  char cmd[16], a[32], b[32];
  while (scanf("%15s", cmd) == 1) {
    if (strcmp(cmd, "conv") == 0) {
      scanf("%31s", a);
      for (int m = 0; m < 4; m++) {
        fesetround(modes[m]);
        vd = from_hex(a);
        float f = (float)vd;
        _Float16 h = (_Float16)vd;
        printf("%08" PRIx32 ":%04" PRIx16 "%s", bits32(f), bits16(h), m < 3 ? " " : "\n");
      }
      fesetround(FE_TONEAREST);
    } else if (strcmp(cmd, "add32") == 0 || strcmp(cmd, "mul32") == 0) {
      scanf("%31s %31s", a, b);
      int add = cmd[0] == 'a';
      for (int m = 0; m < 4; m++) {
        fesetround(FE_TONEAREST);
        vf = (float)from_hex(a);
        vf2 = (float)from_hex(b);
        fesetround(modes[m]);
        float r = add ? vf + vf2 : vf * vf2;
        printf("%08" PRIx32 "%s", bits32(r), m < 3 ? " " : "\n");
      }
      fesetround(FE_TONEAREST);
    } else if (strcmp(cmd, "rng") == 0) {
      uint32_t seed; int count;
      scanf("%" SCNu32 " %d", &seed, &count);
      uint32_t st = seed;
      for (int i = 0; i < 4; i++) s[i] = splitmix32(&st);
      if ((s[0] | s[1] | s[2] | s[3]) == 0) s[0] = 1;
      for (int i = 0; i < count; i++) printf("%" PRIu32 "%s", next(), i < count - 1 ? " " : "\n");
    }
  }
  (void)bits64;
  return 0;
}
