export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-zinc-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}
