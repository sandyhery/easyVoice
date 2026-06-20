// tests/normalize.test.ts
import {
  normalizeForTTS,
  numberToCn,
  percentToCn,
  currencyToCn,
} from "../src/services/normalize.service";

describe("numberToCn", () => {
  test("零到十", () => {
    expect(numberToCn("0")).toBe("零");
    expect(numberToCn("5")).toBe("五");
    expect(numberToCn("10")).toBe("十");
    expect(numberToCn("12")).toBe("十二");
    expect(numberToCn("20")).toBe("二十");
  });

  test("百千万", () => {
    expect(numberToCn("100")).toBe("一百");
    expect(numberToCn("1024")).toBe("一千零二十四");
    expect(numberToCn("10000")).toBe("一万");
    expect(numberToCn("12345")).toBe("一万二千三百四十五");
    expect(numberToCn("100000000")).toBe("一亿");
  });

  test("负数和小数", () => {
    expect(numberToCn("-12.5")).toBe("负十二点五");
    expect(numberToCn("0.14")).toBe("零点一四");
  });

  test("科学计数法", () => {
    expect(numberToCn("1e3")).toBe("一千");
    expect(numberToCn("2.5e4")).toBe("二万五千");
  });
});

describe("percentToCn", () => {
  test("常见百分号", () => {
    expect(percentToCn("12%")).toBe("百分之十二");
    expect(percentToCn("50.5%")).toBe("百分之五十点五");
    expect(percentToCn("120%")).toBe("百分之一百二十");
  });
});

describe("currencyToCn", () => {
  test("前后缀货币", () => {
    expect(currencyToCn("¥1200")).toBe("一千二百元");
    expect(currencyToCn("$12.5")).toBe("十二点五美元");
    expect(currencyToCn("100元")).toBe("一百元");
    expect(currencyToCn("50欧元")).toBe("五十欧元");
  });
});

describe("normalizeForTTS 整合", () => {
  test("URL / 邮箱被屏蔽", () => {
    expect(normalizeForTTS("看 https://github.com/foo")).toContain("网址链接");
    expect(normalizeForTTS("发到 a@b.com 就行")).toContain("电子邮箱");
  });

  test("数字 + 单位", () => {
    expect(normalizeForTTS("重量5kg")).toBe("重量五千克");
    expect(normalizeForTTS("距离32km")).toBe("距离三十二千米");
    expect(normalizeForTTS("今天32°C")).toBe("今天三十二摄氏度");
  });

  test("英文缩写", () => {
    expect(normalizeForTTS("Dr. Smith")).toContain("Doctor");
    expect(normalizeForTTS("Mr. Wang")).toContain("Mister");
  });

  test("保号语义 007", () => {
    // 007 不能被读成 "七"
    expect(normalizeForTTS("编号 007")).toContain("零零七");
  });
});