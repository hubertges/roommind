import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tokens } from "../../styles/tokens";

/**
 * Summary pill like HA's badges: icon plus text from the default slot (`<b>` for the value).
 * `tone` colours the icon only (heat, cool, warn, error, ok), the text stays neutral.
 */
@customElement("rs-pill")
export class RsPill extends LitElement {
  @property({ type: String }) public icon = "";
  @property({ type: String, reflect: true }) public tone:
    "default" | "heat" | "cool" | "humidify" | "dehumidify" | "warn" | "error" | "ok" = "default";

  static styles = [
    tokens,
    css`
      :host {
        display: inline-flex;
        flex: none;
        --pill-icon: var(--secondary-text-color);
        --pill-bg: var(--card-background-color, var(--primary-background-color));
        --pill-border: var(--divider-color);
        --pill-text: var(--primary-text-color);
      }

      :host([tone="heat"]) {
        --pill-icon: var(--rs-heat);
      }
      :host([tone="cool"]) {
        --pill-icon: var(--rs-cool);
      }
      :host([tone="humidify"]) {
        --pill-icon: var(--rs-humidify);
        --pill-bg: color-mix(in srgb, var(--rs-humidify) 14%, var(--card-background-color, var(--primary-background-color)));
        --pill-border: color-mix(in srgb, var(--rs-humidify) 48%, transparent);
        --pill-text: var(--rs-humidify-text);
      }
      :host([tone="dehumidify"]) {
        --pill-icon: var(--rs-dehumidify);
        --pill-bg: color-mix(in srgb, var(--rs-dehumidify) 14%, var(--card-background-color, var(--primary-background-color)));
        --pill-border: color-mix(in srgb, var(--rs-dehumidify) 48%, transparent);
        --pill-text: var(--rs-dehumidify-text);
      }
      :host([tone="warn"]) {
        --pill-icon: var(--rs-warn);
      }
      :host([tone="error"]) {
        --pill-icon: var(--rs-err);
      }
      :host([tone="ok"]) {
        --pill-icon: var(--rs-ok);
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        box-sizing: border-box;
        padding: 0 12px 0 8px;
        border-radius: 16px;
        border: 1px solid var(--pill-border);
        background: var(--pill-bg);
        color: var(--pill-text);
        font-size: 13px;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
        --mdc-icon-size: 18px;
      }

      ha-icon {
        color: var(--pill-icon);
        display: inline-flex;
      }

      ::slotted(b) {
        font-weight: 500;
      }
    `,
  ];

  render() {
    return html`<span class="pill"
      ><ha-icon .icon=${this.icon} aria-hidden="true"></ha-icon><slot></slot
    ></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-pill": RsPill;
  }
}
