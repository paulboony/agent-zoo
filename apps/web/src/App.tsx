import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { EmptyState } from "./components/empty-state.js";

export function App() {
  return (
    <BrowserRouter>
      <div className="flex h-full w-full flex-col">
        <header className="flex h-12 items-center border-border border-b px-4">
          <h1 className="font-semibold">Agent Zoo</h1>
        </header>
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route
              path="/"
              element={
                <EmptyState message="Dashboard scaffolding ready. Sessions will appear here." />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
