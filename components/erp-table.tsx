interface ERPTableProps {
  columns: string[];
  rows: Array<Array<string | number | boolean>>;
  statusCol?: number;
}

function StatusBadge({ value }: { value: string }) {
  const s = value.replace(/_/g, " ");
  let classes = "bg-surface-highest text-secondary";

  if (["Delivered", "Active", "Awarded", "Posted", "Resolved", "Yes"].includes(s))
    classes = "bg-success-dim/10 text-success-dim";
  else if (["At Risk", "High", "Blocked", "Failed"].includes(s))
    classes = "bg-error/10 text-error";
  else if (["In Transit", "Processing", "Procurement", "Sent", "Quoted", "Pending", "Under Review"].includes(s))
    classes = "bg-info/10 text-info";
  else if (["Expiring", "Medium", "Watch"].includes(s))
    classes = "bg-warning/10 text-warning";

  return (
    <span className={`${classes} px-2 py-0.5 rounded-full text-[0.6rem] font-bold uppercase inline-block`}>
      {s}
    </span>
  );
}

export function ERPTable({ columns, rows, statusCol }: ERPTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[0.75rem]">
        <thead className="bg-surface-container text-secondary uppercase text-[0.6rem] font-bold tracking-wider">
          <tr>
            {columns.map((col) => (
              <th key={col} className="px-5 py-3">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant/10">
          {rows.map((row, idx) => (
            <tr key={idx} className="hover:bg-surface-highest transition-colors cursor-pointer">
              {row.map((cell, cellIdx) => (
                <td key={cellIdx} className={`px-5 py-3.5 ${cellIdx === 0 ? "font-semibold" : ""} ${cellIdx > 0 && cellIdx !== statusCol ? "text-secondary" : ""}`}>
                  {statusCol === cellIdx ? (
                    <StatusBadge value={String(cell)} />
                  ) : (
                    String(cell)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
