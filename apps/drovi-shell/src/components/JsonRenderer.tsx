import { ReactNode } from "react";

interface JsonRendererProps {
  payload: Record<string, unknown>;
}

function renderValue(value: unknown): ReactNode {
  if (Array.isArray(value)) {
    return (
      <ul className="json__list">
        {value.map((item, index) => (
          <li key={index} className="json__item">
            {renderValue(item)}
          </li>
        ))}
      </ul>
    );
  }

  if (value && typeof value === "object") {
    return (
      <div className="json__object">
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
          <div key={key} className="json__row">
            <span className="json__key">{key}</span>
            <span className="json__value">{renderValue(item)}</span>
          </div>
        ))}
      </div>
    );
  }

  return <span className="json__scalar">{String(value)}</span>;
}

export function JsonRenderer({ payload }: JsonRendererProps) {
  return <div className="json__root">{renderValue(payload)}</div>;
}
