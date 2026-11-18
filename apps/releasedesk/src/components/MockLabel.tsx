export function MockLabel({ children = "MOCK" }: { children?: string }) {
  return <span className="mock-chip">{children}</span>;
}
