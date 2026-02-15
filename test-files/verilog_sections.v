module verilog_sections;
  // %% Registers
  reg clk;
  reg [3:0] count;

  // %% Clock
  initial begin
    clk = 0;
    #5 clk = ~clk;
  end

  // %% Counter behaviour
  always @(posedge clk) begin
    count <= count + 1'b1;
  end
endmodule
