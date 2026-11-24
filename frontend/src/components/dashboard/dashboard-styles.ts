import { css } from "lit";

/** Layout shared by the dashboard and its edit mode: grid, floor headings, pills, boiler & humidifier strips, empty states. */
export const dashboardStyles = css`
  :host {
    display: block;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(330px, 100%), 1fr));
    gap: 12px;
  }

  h2.floor {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 20px 4px 10px;
    font-size: 16px;
    font-weight: 500;
  }

  h2.floor:first-of-type {
    margin-top: 4px;
  }

  h2.floor .count {
    font-weight: 400;
    font-size: 14px;
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
  }

  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 12px;
  }

  .pills > span {
    display: inline-flex;
  }

  /* Distinct-color humidification stats card on main dashboard */
  .hum-stats-card {
    margin: 0 0 14px;
    padding: 12px 16px;
    border-radius: var(--rs-radius);
    border: 1px solid color-mix(in srgb, var(--rs-humidify) 42%, transparent);
    background: color-mix(
      in srgb,
      var(--rs-humidify) 9%,
      var(--card-background-color, var(--primary-background-color))
    );
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .hum-stats-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }

  .hum-stats-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--rs-humidify-text);
    --mdc-icon-size: 20px;
  }

  .hum-stats-title ha-icon {
    color: var(--rs-humidify);
  }

  .hum-stats-kpis {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 13px;
    color: var(--primary-text-color);
    font-variant-numeric: tabular-nums;
  }

  .hum-stats-kpis .kpi {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--rs-humidify) 14%, transparent);
    color: var(--rs-humidify-text);
    font-weight: 500;
  }

  .hum-stats-kpis .kpi.dehum {
    background: color-mix(in srgb, var(--rs-dehumidify) 16%, transparent);
    color: var(--rs-dehumidify-text);
  }

  .hum-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .hum-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--rs-humidify) 30%, var(--divider-color));
    background: var(--card-background-color, var(--primary-background-color));
    color: var(--primary-text-color);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    font-family: inherit;
    --mdc-icon-size: 16px;
  }

  .hum-chip:hover {
    border-color: var(--rs-humidify);
  }

  .hum-chip.humidifying {
    border-color: var(--rs-humidify);
    background: color-mix(in srgb, var(--rs-humidify) 16%, var(--card-background-color));
    color: var(--rs-humidify-text);
    font-weight: 500;
  }

  .hum-chip.dehumidifying {
    border-color: var(--rs-dehumidify);
    background: color-mix(in srgb, var(--rs-dehumidify) 16%, var(--card-background-color));
    color: var(--rs-dehumidify-text);
    font-weight: 500;
  }

  /* Boiler / Heat Plant live sensors strip on main dashboard */
  .plants-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
    gap: 10px;
    margin: 0 0 14px;
  }

  .plant-mini {
    padding: 12px 14px;
    border-radius: var(--rs-radius);
    border: 1px solid var(--divider-color);
    background: var(--card-background-color, var(--primary-background-color));
    display: flex;
    flex-direction: column;
    gap: 8px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    color: var(--primary-text-color);
    transition: border-color 0.15s ease;
  }

  .plant-mini:hover {
    border-color: var(--rs-border-strong);
  }

  .plant-mini.active {
    border-color: color-mix(in srgb, var(--rs-heat) 45%, var(--divider-color));
  }

  .plant-mini.hold {
    border-color: color-mix(in srgb, var(--rs-warn) 45%, var(--divider-color));
  }

  .plant-mini.overheat {
    border-color: var(--rs-err);
    background: color-mix(in srgb, var(--rs-err) 8%, var(--card-background-color));
  }

  .plant-mini-top {
    display: flex;
    align-items: center;
    gap: 8px;
    --mdc-icon-size: 20px;
  }

  .plant-mini-top ha-icon {
    color: var(--rs-heat);
  }

  .plant-mini-name {
    font-size: 14px;
    font-weight: 500;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plant-mini-state {
    font-size: 11px;
    font-weight: 500;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--rs-fill);
    color: var(--secondary-text-color);
    white-space: nowrap;
  }

  .plant-mini-state.active {
    background: color-mix(in srgb, var(--rs-heat) 18%, transparent);
    color: var(--rs-heat-text);
  }

  .plant-mini-state.hold {
    background: color-mix(in srgb, var(--rs-warn) 18%, transparent);
    color: var(--rs-warn-text);
  }

  .plant-mini-state.overheat {
    background: color-mix(in srgb, var(--rs-err) 20%, transparent);
    color: var(--rs-err-text);
  }

  .plant-mini-sensors {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    font-size: 12px;
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
  }

  .plant-mini-sensors span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    --mdc-icon-size: 14px;
  }

  .plant-mini-sensors b {
    color: var(--primary-text-color);
    font-weight: 500;
  }

  .plant-mini-alerts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .plant-alert-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    background: color-mix(in srgb, var(--rs-err) 16%, transparent);
    color: var(--rs-err-text);
    --mdc-icon-size: 13px;
  }

  @media (max-width: 600px) {
    .pills {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
      /* the pills scroll inside the content box, the page itself never gets wider */
      max-width: 100%;
      padding-bottom: 2px;
    }

    .pills::-webkit-scrollbar {
      display: none;
    }
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 72px 16px;
    text-align: center;
    color: var(--secondary-text-color);
  }

  .placeholder ha-icon {
    --mdc-icon-size: 56px;
    opacity: 0.4;
  }

  .placeholder p {
    margin: 0;
    font-size: 15px;
    max-width: 400px;
    line-height: 1.5;
  }
`;
