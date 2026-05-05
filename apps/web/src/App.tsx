import type { AgentKind } from "@agent-zoo/shared";
import { Fragment } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { EmptyState } from "./components/empty-state.js";
import { Mascot, type MascotState } from "./components/mascot.js";
import { ThemePicker } from "./components/theme-picker.js";

const KINDS: AgentKind[] = ["main", "code-reviewer", "explorer", "writer", "general"];
const STATES: MascotState[] = ["running", "waiting", "idle", "error"];

function MascotMatrix() {
  return (
    <div className="grid grid-cols-[auto_repeat(4,1fr)] gap-4 p-6">
      <div />
      {STATES.map((s) => (
        <div key={s} className="text-center text-sm font-medium">
          {s}
        </div>
      ))}
      {KINDS.map((kind) => (
        <Fragment key={kind}>
          <div className="self-center text-sm font-medium">{kind}</div>
          {STATES.map((state) => (
            <div key={`${kind}-${state}`} className="flex items-center justify-center">
              <Mascot kind={kind} state={state} size={72} />
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <div className="flex h-full w-full flex-col">
        <header className="flex h-12 items-center justify-between border-border border-b px-4">
          <h1 className="font-semibold">Agent Zoo</h1>
          <ThemePicker />
        </header>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<MascotMatrix />} />
            <Route
              path="/sessions"
              element={<EmptyState message="Sessions list — implemented in Task 13." />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
