export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-fg/60">
      <p className="max-w-sm text-center text-sm">{message}</p>
    </div>
  );
}
