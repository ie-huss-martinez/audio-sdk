import { afterEach, describe, expect, it } from "vitest";
import stylesUrl from "./styles.css?url";

const added: Element[] = [];

afterEach(() => {
  for (const element of added.splice(0)) {
    element.remove();
  }
});

async function loadStyles(): Promise<CSSStyleSheet> {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = stylesUrl;
  const loaded = new Promise<void>((resolve, reject) => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => reject(new Error("styles.css failed to load")), {
      once: true,
    });
  });
  document.head.append(link);
  added.push(link);
  await loaded;
  if (!link.sheet) {
    throw new Error("styles.css loaded without a stylesheet");
  }
  return link.sheet;
}

function addStyle(css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  added.push(style);
}

describe("styles.css", () => {
  it("declares the cascade layers first, in the order of ADR 0005", async () => {
    const sheet = await loadStyles();
    const first = sheet.cssRules[0];
    expect(first).toBeInstanceOf(CSSLayerStatementRule);
    expect([...(first as CSSLayerStatementRule).nameList]).toEqual([
      "hm.tokens",
      "hm.base",
      "hm.components",
      "hm.sdk",
    ]);
  });

  it("makes the SDK's layer beat ui's, whatever order their rules load in", async () => {
    await loadStyles();
    // Each rule is in an earlier layer than the one before it, so without the
    // declared order the last rule in the source would win.
    addStyle(`
      @layer hm.sdk { .hm-audio-layer-probe { order: 4; } }
      @layer hm.components { .hm-audio-layer-probe { order: 3; } }
      @layer hm.base { .hm-audio-layer-probe { order: 2; } }
      @layer hm.tokens { .hm-audio-layer-probe { order: 1; } }
    `);
    const probe = document.createElement("div");
    probe.className = "hm-audio-layer-probe";
    document.body.append(probe);
    added.push(probe);
    expect(getComputedStyle(probe).order).toBe("4");

    // A host's unlayered CSS beats every hm layer, without !important.
    addStyle(".hm-audio-layer-probe { order: 5; }");
    expect(getComputedStyle(probe).order).toBe("5");
  });
});
