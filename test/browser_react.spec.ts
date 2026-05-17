import { describe, expect, test } from "bun:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { createBrowserLog } from "../src/browser/index";
import { LogErrorBoundary, LogProvider, useLog } from "../src/browser/react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function createMemoryTransport() {
  const entries: any[] = [];

  return {
    transport: {
      name: "memory",
      write(rows: any[]) {
        entries.push(...rows.map((row) => ({ ...row })));
      },
    },
    entries,
  };
}

describe("browser react adapter", () => {
  test("provides the supplied logger through LogProvider and useLog", async () => {
    const memory = createMemoryTransport();
    const log = createBrowserLog({
      console: false,
      transports: [memory.transport],
    });
    let rootLog: any;
    let groupedLog: any;
    const originalError = console.error;

    function Capture() {
      rootLog = useLog();
      groupedLog = useLog("ui.button");
      return React.createElement("button", null, "save");
    }

    try {
      console.error = () => {};

      await act(async () => {
        TestRenderer.create(
          React.createElement(LogProvider, { log }, React.createElement(Capture)),
        );
      });
    } finally {
      console.error = originalError;
    }

    expect(rootLog).toBe(log);
    expect(typeof groupedLog.info).toBe("function");

    groupedLog.info("clicked");
    await log.flush();

    expect(memory.entries[0].group).toBe("ui.button");
    expect(memory.entries[0].message).toBe("clicked");

    await log.close();
  });

  test("useLog throws without a provider", async () => {
    function MissingProvider() {
      useLog();
      return null;
    }

    const originalError = console.error;
    let caught: unknown;

    try {
      console.error = () => {};

      try {
        await act(async () => {
          TestRenderer.create(React.createElement(MissingProvider));
        });
      } catch (error) {
        caught = error;
      }
    } finally {
      console.error = originalError;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("missing-log-provider");
  });

  test("LogErrorBoundary logs render errors and renders fallback", async () => {
    const memory = createMemoryTransport();
    const log = createBrowserLog({
      console: false,
      transports: [memory.transport],
    });
    const originalError = console.error;

    try {
      console.error = () => {};

      function Boom(): never {
        throw new Error("render broke");
      }

      let renderer: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(
            LogProvider,
            { log },
            React.createElement(
              LogErrorBoundary,
              {
                fallback: React.createElement("div", null, "fallback"),
              },
              React.createElement(Boom),
            ),
          ),
        );
      });

      await log.flush();

      expect(renderer!.toJSON()).toEqual({
        type: "div",
        props: {},
        children: ["fallback"],
      });
      expect(memory.entries).toHaveLength(1);
      expect(memory.entries[0].group).toBe("react.error_boundary");
      expect(memory.entries[0].origin).toEqual({ source: "react", instance: null });
      expect(memory.entries[0].metadata.componentStack).toContain("Boom");
    } finally {
      console.error = originalError;
      await log.close();
    }
  });
});
