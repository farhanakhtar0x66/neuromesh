// One test per formula. Expected values are written from README.md, not produced by running anything.
import test from "node:test";
import assert from "node:assert/strict";
import { CellError, Sheet } from "../src/index.js";

const E = (code) => ({ error: code });
const DIV0 = E("#DIV/0!");
const REF = E("#REF!");
const VALUE = E("#VALUE!");
const NAME = E("#NAME?");
const CIRC = E("#CIRC!");

const show = (v) => (v instanceof CellError ? { error: v.code } : v);

/** The sheet every case is evaluated in. */
function fixture() {
  const s = new Sheet();
  s.set("A1", 10);
  s.set("A2", 20);
  s.set("A3", 30);
  s.set("A4", "abc");
  // A5 stays empty
  s.set("B1", "Hello");
  s.set("B2", "5"); // a number
  s.set("B3", "=TRUE");
  s.set("B4", "=1/0");
  s.set("B5", "=FOO(1)");
  s.set("C1", "=A1+A2");
  s.set("C2", "2.5");
  s.set("C3", "-3");
  s.set("F1", "=F2");
  s.set("F2", "=F1");
  s.set("G1", 5);
  s.set("G2", "apple");
  s.set("G3", "Apple");
  s.set("G4", "banana");
  s.set("G5", "=TRUE");
  s.set("G6", 5);
  s.set("G7", "=1/0");
  // G8 stays empty
  s.set("G9", 12);
  return s;
}

const CASES = [
  // arithmetic and precedence
  ["=1+2", 3],
  ["=1+2*3", 7],
  ["=(1+2)*3", 9],
  ["=2-3-4", -5],
  ["=8/2/2", 2],
  ["=2^3", 8],
  ["=2^3^2", 64],
  ["=-2^2", 4],
  ["=2^-1", 0.5],
  ["=--3", 3],
  ["=-(-3)", 3],
  ["=+5", 5],
  ["=10-+3", 7],
  ["=2*-3", -6],
  ["=7/2", 3.5],
  ["=0.1+0.2", 0.30000000000000004],
  ["=1.5e2+1", 151],
  ["=.5+.5", 1],
  ["=1E2", 100],
  ["=2*3^2", 18],
  ["=-3^2*2", 18],
  ["=2^2*3", 12],
  ["=10/4*2", 5],
  ["=1-2+3", 2],
  ["=(2+3)^2", 25],
  ["=4^0.5", 2],
  ["=2^3^0", 1],
  ["= 1 +\t2 ", 3],
  ["=10^2^-1", 0.01],
  ["=3*(2+(1+1))", 12],
  ["=-A1^2", 100],
  ["=A1^-1", 0.1],
  // zero, overflow, negative zero
  ["=1/0", DIV0],
  ["=0/0", DIV0],
  ["=5/(2-2)", DIV0],
  ["=10^400", VALUE],
  ["=0^-1", VALUE],
  ["=0*-1", 0],
  ["=-0", 0],
  ["=(-8)^(1/3)", VALUE],
  // text
  ['="a"&"b"', "ab"],
  ['="a"&1+2', "a3"],
  ["=1&2", "12"],
  ['="x"&TRUE', "xTRUE"],
  ['="x"&A5', "x"],
  ["=A5&A5", ""],
  ['="say ""hi"""', 'say "hi"'],
  ['=""', ""],
  ['=0.1+0.2&""', "0.30000000000000004"],
  ['=1e21&""', "1e+21"],
  ['=-0&""', "0"],
  ['=A1&"-"&A2', "10-20"],
  ['="a"&"b"="ab"', true],
  ['=1+1&"x"', "2x"],
  ["=A4&B1", "abcHello"],
  // comparison
  ["=1<2", true],
  ["=2<=2", true],
  ["=3>4", false],
  ["=3>=3", true],
  ["=1=1", true],
  ["=1<>1", false],
  ["=1<>2", true],
  ['="a"="A"', true],
  ['="a"<"B"', true],
  ['="Z"<"a"', false],
  ['="abc"<"abd"', true],
  ['=1<"a"', true],
  ['="a"<TRUE', true],
  ['=1="1"', false],
  ['=1<>"1"', true],
  ["=TRUE>5", true],
  ["=FALSE<TRUE", true],
  ["=TRUE=1", false],
  ["=A5=0", true],
  ['=A5=""', true],
  ["=A5=FALSE", true],
  ["=A5=A5", true],
  ["=A5<1", true],
  ["=A5<>0", false],
  ["=1+1=2", true],
  ["=1=1=TRUE", true],
  ['="10"<"9"', true],
  ['="a"&"b"<>"ab"', false],
  ["=A1>A2", false],
  ["=B1=\"hello\"", true],
  ["=B2=5", true],
  // references and conversions
  ["=A1", 10],
  ["=A1+A2", 30],
  ["=a1+a2", 30],
  ["=A5", 0],
  ["=A5+1", 1],
  ["=A4", "abc"],
  ["=A4+1", VALUE],
  ["=B2+1", 6],
  ['="5"+1', 6],
  ['=" 5 "*2', 10],
  ["=TRUE+1", 2],
  ["=FALSE*5", 0],
  ["=-TRUE", -1],
  ['=+"abc"', VALUE],
  ['=+"3"', 3],
  ["=B3", true],
  ["=B4", DIV0],
  ["=B4+1", DIV0],
  ["=1+B4", DIV0],
  ['="x"+B4', DIV0],
  ["=B4+B5", DIV0],
  ["=B5+B4", NAME],
  ["=B5", NAME],
  ["=C1*2", 60],
  ["=C2*2", 5],
  ["=C3^2", 9],
  ['="x"+1', VALUE],
  ["=A1:A2", VALUE],
  ["=A1:A2+1", VALUE],
  ["=ROUND(A1:A2,0)", VALUE],
  ["=F1", CIRC],
  ["=F1+1", CIRC],
  // invalid references, names, syntax
  ["=A0", REF],
  ["=AAA1", REF],
  ["=A100001", REF],
  ["=A0+1", REF],
  ["=FOO", NAME],
  ["=A1B", NAME],
  ["=FOO(1,2)", NAME],
  ["=FOO(1/0)", NAME],
  ["=foo(B4)", NAME],
  ["=ISBLANK(A5)", NAME],
  ["=1+", VALUE],
  ["=(1", VALUE],
  ["=1 2", VALUE],
  ["=", VALUE],
  ["=1+*2", VALUE],
  ["=A1:", VALUE],
  ['="abc', VALUE],
  ["=1@2", VALUE],
  ["=SUM(1,)", VALUE],
  ["=SUM(,1)", VALUE],
  ["=true", true],
  ["=False", false],
  ["=Sum(1,2)", 3],
  ["=SUM()", VALUE],
  ["=IF(1)", VALUE],
  ["=IF(1,2,3,4)", VALUE],
  ["=ROUND(1,2,3)", VALUE],
  ["=COUNTIF(A1:A3)", VALUE],
  ["=COUNT()", VALUE],
  ["=SUM(A1:AAA1)", REF],
  // SUM AVERAGE MIN MAX COUNT
  ["=SUM(1,2,3)", 6],
  ["=SUM(A1:A3)", 60],
  ["=SUM(A1:A5)", 60],
  ["=SUM(A1,A2)", 30],
  ["=SUM(A1:A2,5)", 35],
  ["=SUM(B2)", 5],
  ["=SUM(B1)", 0],
  ["=SUM(A4)", 0],
  ["=SUM(A5)", 0],
  ["=SUM(B3)", 0],
  ['=SUM("3")', 3],
  ['=SUM("x")', VALUE],
  ['=SUM(TRUE,"3")', 4],
  ["=SUM(A1:B2)", 35],
  ["=SUM(B2:A1)", 35],
  ["=SUM(A1:A3,B4)", DIV0],
  ["=SUM(B4:B5)", DIV0],
  ["=SUM(B5:B4)", DIV0],
  ['=SUM("x",B4)', DIV0],
  ["=SUM((A1))", 10],
  ["=SUM((A4))", VALUE],
  ["=SUM((B3))", 1],
  ["=SUM(A1:A3)/COUNT(A1:A3)", 20],
  ["=AVERAGE(A1:A3)", 20],
  ["=AVERAGE(A1:A5)", 20],
  ["=AVERAGE(A4:A5)", DIV0],
  ["=AVERAGE(1,2)", 1.5],
  ["=AVERAGE(B1)", DIV0],
  ["=AVERAGE(TRUE,3)", 2],
  ["=MIN(A1:A3)", 10],
  ["=MAX(A1:A3)", 30],
  ["=MIN(5,2,8)", 2],
  ["=MAX(5,2,8)", 8],
  ["=MIN(A4:A5)", 0],
  ["=MAX(A4:A5)", 0],
  ["=MIN(C3,A1)", -3],
  ["=MAX(-5,-2)", -2],
  ["=MAX(A1:A3)-MIN(A1:A3)", 20],
  ["=COUNT(A1:A5)", 3],
  ["=COUNT(A1:B5)", 4],
  ['=COUNT(1,"2",TRUE,"x")', 1],
  ["=COUNT(B4)", 0],
  ["=COUNT(1/0)", 0],
  ["=COUNT(A1,A2,A4)", 2],
  ["=SUM(C1)", 30],
  ["=SUM(IF(TRUE,A1,A2),A3)", 40],
  // IF
  ["=IF(TRUE,1,2)", 1],
  ["=IF(FALSE,1,2)", 2],
  ["=IF(FALSE,1)", false],
  ["=IF(TRUE,1)", 1],
  ['=IF(0,"y","n")', "n"],
  ['=IF(2,"y","n")', "y"],
  ['=IF(-1,"y","n")', "y"],
  ['=IF(A5,"y","n")', "n"],
  ['=IF("x",1,2)', VALUE],
  ["=IF(B4,1,2)", DIV0],
  ["=IF(TRUE,1,1/0)", 1],
  ["=IF(FALSE,1/0,7)", 7],
  ["=IF(TRUE,1/0,7)", DIV0],
  ['=IF(A1>5,"big","small")', "big"],
  ["=IF(A5,1,A5)", 0],
  ["=IF(TRUE,A5)+1", 1],
  ["=IF(A1:A2,1,2)", VALUE],
  ["=IF(1,A1:A2,2)", VALUE],
  ['=IF(1<2,IF(2<1,"a","b"),"c")', "b"],
  ['=IF(SUM(A1:A3)>50,"high","low")', "high"],
  // ROUND
  ["=ROUND(2.5)", 3],
  ["=ROUND(-2.5)", -3],
  ["=ROUND(1.005,2)", 1.01],
  ["=ROUND(2.675,2)", 2.68],
  ["=ROUND(-1.005,2)", -1.01],
  ["=ROUND(1234.5678,-2)", 1200],
  ["=ROUND(1234.5678,2)", 1234.57],
  ["=ROUND(0.5)", 1],
  ["=ROUND(-0.4)", 0],
  ["=ROUND(1.5,0.9)", 2],
  ["=ROUND(5,-1)", 10],
  ['=ROUND("2.5")', 3],
  ['=ROUND("x")', VALUE],
  ["=ROUND(1.5,16)", VALUE],
  ["=ROUND(1.5,-16)", VALUE],
  ["=ROUND(A1/3,2)", 3.33],
  ["=ROUND(2.5,B4)", DIV0],
  ["=ROUND(0.285,2)", 0.29],
  ["=ROUND(1e-7,7)", 1e-7],
  ["=ROUND(AVERAGE(A1:A3)/3,1)", 6.7],
  // COUNTIF
  ["=COUNTIF(G1:G9,5)", 2],
  ['=COUNTIF(G1:G9,"5")', 2],
  ['=COUNTIF(G1:G9,"=5")', 2],
  ['=COUNTIF(G1:G9,">5")', 1],
  ['=COUNTIF(G1:G9,">=5")', 3],
  ['=COUNTIF(G1:G9,"<12")', 2],
  ['=COUNTIF(G1:G9,"<=12")', 3],
  ['=COUNTIF(G1:G9,"<>5")', 5],
  ['=COUNTIF(G1:G9,"apple")', 2],
  ['=COUNTIF(G1:G9,"APPLE")', 2],
  ['=COUNTIF(G1:G9,"=apple")', 2],
  ['=COUNTIF(G1:G9,"<>apple")', 5],
  ['=COUNTIF(G1:G9,">apple")', 1],
  ['=COUNTIF(G1:G9,"<banana")', 2],
  ["=COUNTIF(G1:G9,TRUE)", 1],
  ["=COUNTIF(G1:G9,FALSE)", 0],
  ["=COUNTIF(G1:G9,G1)", 2],
  ["=COUNTIF(G1:G9,G8)", 0],
  ["=COUNTIF(G1:G9,B4)", DIV0],
  ["=COUNTIF(5,5)", VALUE],
  ["=COUNTIF((G1),5)", VALUE],
  ['=COUNTIF(G1:G9,"> 5")', 1],
  ["=COUNTIF(G1:G9,A1:A2)", VALUE],
  ['=COUNTIF(A1:A5,">15")', 2],
  ['=COUNTIF(A1:A5,"abc")', 1],
  ['=COUNTIF(A1:A5,">"&A1)', 2],
  ["=COUNTIF(G7,5)", 0],
  ["=COUNTIF(G1,5)", 1],
];

const seen = new Set();
CASES.forEach(([formula, expected], i) => {
  const name = `formula ${String(i + 1).padStart(3, "0")}: ${formula.replace(/\t/g, " ")}`;
  assert.ok(!seen.has(name), `duplicate case ${name}`);
  seen.add(name);
  test(name, () => {
    const s = fixture();
    s.set("Z1", formula);
    assert.deepStrictEqual(show(s.get("Z1")), expected);
  });
});
