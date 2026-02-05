import type { ReactNode } from "react";

interface JsonRendererProps {
  payload: Record<string, unknown>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

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

function renderMetrics(metrics: Record<string, unknown>) {
  const entries = Object.entries(metrics);
  if (!entries.length) {
    return null;
  }
  return (
    <div className="metrics">
      {entries.map(([key, value]) => (
        <div key={key} className="metric">
          <div className="metric__label">{key.replace(/_/g, " ")}</div>
          <div className="metric__value">{String(value)}</div>
        </div>
      ))}
    </div>
  );
}

function renderTable(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return null;
  const headers = Array.from(
    rows.reduce((acc, row) => {
      Object.keys(row).forEach((key) => acc.add(key));
      return acc;
    }, new Set<string>()),
  );
  return (
    <div className="table">
      <div className="table__row table__row--header">
        {headers.map((header) => (
          <div key={header} className="table__cell">
            {header}
          </div>
        ))}
      </div>
      {rows.map((row, index) => (
        <div key={index} className="table__row">
          {headers.map((header) => (
            <div key={header} className="table__cell">
              {row[header] ? String(row[header]) : "—"}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function renderChart(chart: Record<string, unknown>) {
  const labels = Array.isArray(chart.labels) ? chart.labels : [];
  const values = Array.isArray(chart.values) ? chart.values : [];
  if (!labels.length || !values.length) {
    return null;
  }
  const maxValue = Math.max(...values.map((value) => Number(value) || 0), 1);
  return (
    <div className="chart">
      {labels.map((label, index) => {
        const value = Number(values[index]) || 0;
        const width = Math.round((value / maxValue) * 100);
        return (
          <div key={label} className="chart__row">
            <div className="chart__label">{label}</div>
            <div className="chart__bar">
              <div className="chart__fill" style={{ width: `${width}%` }} />
            </div>
            <div className="chart__value">{value}</div>
          </div>
        );
      })}
    </div>
  );
}

function renderTimeline(items: Array<Record<string, unknown>>) {
  if (!items.length) return null;
  return (
    <div className="timeline timeline--compact">
      {items.map((item, index) => (
        <div key={`${item.time ?? index}`} className="timeline__item">
          <div className="timeline__time">{String(item.time ?? "—")}</div>
          <div className="timeline__body">
            <div className="timeline__label">{String(item.label ?? "Event")}</div>
            <div className="timeline__detail">{String(item.detail ?? "")}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function renderEvidence(evidence: Array<Record<string, unknown>>) {
  if (!evidence.length) return null;
  return (
    <div className="evidence">
      {evidence.map((item, index) => (
        <div key={item.id ? String(item.id) : index} className="evidence__item">
          <div className="evidence__meta">{String(item.source ?? "source")}</div>
          <div className="evidence__snippet">{String(item.snippet ?? "")}</div>
        </div>
      ))}
    </div>
  );
}

function renderMap(locations: Array<Record<string, unknown>>) {
  if (!locations.length) return null;
  return (
    <div className="map">
      {locations.map((location, index) => (
          <div key={location.name ? String(location.name) : index} className="map__item">
            <div className="map__label">{String(location.name ?? "Location")}</div>
            <div className="map__coords">
              {String(location.lat ?? "—")}, {String(location.lon ?? "—")}
            </div>
          </div>
      ))}
    </div>
  );
}

export function JsonRenderer({ payload }: JsonRendererProps) {
  const renderSpec = Array.isArray(payload.render) ? payload.render : null;

  if (renderSpec) {
    return (
      <div className="json__root">
        {renderSpec.map((block, index) => {
          if (!isObject(block)) {
            return <div key={index}>{renderValue(block)}</div>;
          }
          const type = String(block.type ?? "raw");
          const title = block.title ? String(block.title) : null;
          const data = block.data;
          return (
            <div key={`${type}-${index}`} className="render__block">
              {title && <h3>{title}</h3>}
              {type === "metrics" && isObject(data) && renderMetrics(data)}
              {type === "table" && Array.isArray(data) && renderTable(data as Array<Record<string, unknown>>)}
              {type === "timeline" && Array.isArray(data) && renderTimeline(data as Array<Record<string, unknown>>)}
              {type === "chart" && isObject(data) && renderChart(data)}
              {type === "map" && Array.isArray(data) && renderMap(data as Array<Record<string, unknown>>)}
              {type === "evidence" && Array.isArray(data) && renderEvidence(data as Array<Record<string, unknown>>)}
              {type === "raw" && renderValue(data)}
            </div>
          );
        })}
      </div>
    );
  }

  const sections: ReactNode[] = [];
  if (isObject(payload.metrics)) {
    sections.push(
      <div key="metrics" className="render__block">
        <h3>Metrics</h3>
        {renderMetrics(payload.metrics)}
      </div>,
    );
  }
  if (Array.isArray(payload.timeline)) {
    sections.push(
      <div key="timeline" className="render__block">
        <h3>Timeline</h3>
        {renderTimeline(payload.timeline as Array<Record<string, unknown>>)}
      </div>,
    );
  }
  if (Array.isArray(payload.table)) {
    sections.push(
      <div key="table" className="render__block">
        <h3>Table</h3>
        {renderTable(payload.table as Array<Record<string, unknown>>)}
      </div>,
    );
  }
  if (isObject(payload.chart)) {
    sections.push(
      <div key="chart" className="render__block">
        <h3>Chart</h3>
        {renderChart(payload.chart)}
      </div>,
    );
  }
  if (Array.isArray(payload.locations)) {
    sections.push(
      <div key="map" className="render__block">
        <h3>Map</h3>
        {renderMap(payload.locations as Array<Record<string, unknown>>)}
      </div>,
    );
  }
  if (Array.isArray(payload.evidence)) {
    sections.push(
      <div key="evidence" className="render__block">
        <h3>Evidence</h3>
        {renderEvidence(payload.evidence as Array<Record<string, unknown>>)}
      </div>,
    );
  }

  if (!sections.length) {
    sections.push(
      <div key="raw" className="render__block">
        {renderValue(payload)}
      </div>,
    );
  }

  return <div className="json__root">{sections}</div>;
}
