#include <stdio.h>

#define GNB_MAX_SLOTS_PER_FRAME 20
#define SCALE_FACTOR(x) ((x) * 2)

// %% Global variables
int number = 52;
static const int limit = 10;

// %% Type Aliases
#ifdef __cplusplus
using gnb_dl_tm_payload_t = int;
using frame_slots_t = unsigned long;
#endif

// %% Function Declarations
void f1(void);
void f2(void);
int f3(int);
int f4(int);

// %% C Blocks
struct Point
{
  int x;
  int y;
};

enum Mode
{
  MODE_A,
  MODE_B
};

typedef union Payload {
  int i;
  float f;
} Payload;

typedef struct
{
  int id;
  int active;
} Record;

#ifdef __cplusplus
// %% C++ Blocks
namespace demo
{
class Worker
{
public:
  int id;
};
}
#endif

// %% Entry point
int main(void)
{
  for (int i = 0; i < 3; ++i) {
    printf("%d\n", i);
  }

  f1();
  return 0;
}

// %% Local Functions
void f1(void) {
}

void f2(void) {
}

int f3(int value)
{
  return value + 1;
}

int f4(int value)
{
  // %% Section A
  if (value > limit) {
    return limit;
  }

  // %% Section B
  return value;
}
