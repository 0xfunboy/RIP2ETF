import { describe, it, expect } from "bun:test";
import { spotTradeTemplate, priceCheckTemplate } from "../templates";

describe("Templates", () => {
  describe("spotTradeTemplate", () => {
    it("should contain XML structure", () => {
      expect(spotTradeTemplate).toContain("<task>");
      expect(spotTradeTemplate).toContain("</task>");
      expect(spotTradeTemplate).toContain("<context>");
      expect(spotTradeTemplate).toContain("</context>");
      expect(spotTradeTemplate).toContain("<rules>");
      expect(spotTradeTemplate).toContain("</rules>");
      expect(spotTradeTemplate).toContain("<instructions>");
      expect(spotTradeTemplate).toContain("</instructions>");
    });

    it("should contain recentMessages placeholder", () => {
      expect(spotTradeTemplate).toContain("{{recentMessages}}");
    });

    it("should contain market order examples", () => {
      expect(spotTradeTemplate).toContain('"buy 1 HYPE"');
      expect(spotTradeTemplate).toContain('"sell 2 HYPE"');
      expect(spotTradeTemplate).toContain('"market buy 1 HYPE"');
      expect(spotTradeTemplate).toContain('"market sell 2 HYPE"');
    });

    it("should contain limit order examples", () => {
      expect(spotTradeTemplate).toContain('"buy 1 HYPE at 20 USDC"');
      expect(spotTradeTemplate).toContain('"sell 0.5 HYPE at 21 USDC"');
      expect(spotTradeTemplate).toContain('"limit buy 1 HYPE at 20 USDC"');
      expect(spotTradeTemplate).toContain('"limit sell 0.5 HYPE at 21 USDC"');
    });

    it("should specify XML return format", () => {
      expect(spotTradeTemplate).toContain(
        "Respond with an XML block containing only the extracted values"
      );
      expect(spotTradeTemplate).toContain("<coin>");
      expect(spotTradeTemplate).toContain("<is_buy>");
      expect(spotTradeTemplate).toContain("<sz>");
      expect(spotTradeTemplate).toContain("<limit_px>");
    });

    it("should contain proper instructions", () => {
      expect(spotTradeTemplate).toContain("Extract the coin symbol");
      expect(spotTradeTemplate).toContain(
        "Determine if it's a buy (true) or sell (false)"
      );
      expect(spotTradeTemplate).toContain("Extract the size/quantity");
      expect(spotTradeTemplate).toContain(
        "Extract limit_px only if a price was specified"
      );
    });
  });

  describe("priceCheckTemplate", () => {
    it("should contain XML structure", () => {
      expect(priceCheckTemplate).toContain("<task>");
      expect(priceCheckTemplate).toContain("</task>");
      expect(priceCheckTemplate).toContain("<context>");
      expect(priceCheckTemplate).toContain("</context>");
      expect(priceCheckTemplate).toContain("<examples>");
      expect(priceCheckTemplate).toContain("</examples>");
      expect(priceCheckTemplate).toContain("<instructions>");
      expect(priceCheckTemplate).toContain("</instructions>");
    });

    it("should contain recentMessages placeholder", () => {
      expect(priceCheckTemplate).toContain("{{recentMessages}}");
    });

    it("should contain price check examples", () => {
      expect(priceCheckTemplate).toContain('"I\'ll check PIP price for you"');
      expect(priceCheckTemplate).toContain('"Let me check the price of HYPE"');
      expect(priceCheckTemplate).toContain('"I\'ll get the current ETH price"');
      expect(priceCheckTemplate).toContain('symbol: PIP');
      expect(priceCheckTemplate).toContain('symbol: HYPE');
      expect(priceCheckTemplate).toContain('symbol: ETH');
    });

    it("should specify XML return format", () => {
      expect(priceCheckTemplate).toContain(
        "Respond with an XML block containing only the extracted value"
      );
      expect(priceCheckTemplate).toContain("<symbol>");
    });

    it("should contain proper instructions", () => {
      expect(priceCheckTemplate).toContain(
        "Extract the token symbol from your last message"
      );
      expect(priceCheckTemplate).toContain("Return just the token symbol");
      expect(priceCheckTemplate).toContain("Remove any suffixes like");
      expect(priceCheckTemplate).toContain(
        "If multiple tokens are mentioned, use the last one"
      );
    });
  });

  describe("Template formatting", () => {
    it("should be properly formatted strings", () => {
      expect(typeof spotTradeTemplate).toBe("string");
      expect(typeof priceCheckTemplate).toBe("string");
    });

    it("should not have excessive whitespace", () => {
      // Check that templates don't start or end with excessive whitespace
      expect(spotTradeTemplate).not.toMatch(/^\s{2,}/);
      expect(spotTradeTemplate).not.toMatch(/\s{2,}$/);
      expect(priceCheckTemplate).not.toMatch(/^\s{2,}/);
      expect(priceCheckTemplate).not.toMatch(/\s{2,}$/);
    });
  });
});
