export function NativeSelect({ value, onChange, options, label, format }: { value: string; onChange: (value: string) => void; options: string[]; label: string; format?: (value: string) => string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 rounded-md border border-white/10 bg-zinc-950 px-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
    >
      {options.map((option) => (
        <option key={option} value={option}>{format ? format(option) : option}</option>
      ))}
    </select>
  );
}
