import { getMermaidResponsiveSizing } from "./mermaid-display";
import {
  SESSION_DAG_ACCESSIBLE_DESCRIPTION,
  SESSION_DAG_ACCESSIBLE_TITLE,
  type CompiledSessionDag,
  type SessionDagDirection,
} from "./session-dag";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const FORBIDDEN_SVG_ELEMENTS = new Set([
  "a",
  "animate",
  "animatemotion",
  "animatetransform",
  "audio",
  "embed",
  "foreignobject",
  "iframe",
  "image",
  "object",
  "script",
  "set",
  "use",
  "video",
]);
const UNSAFE_CSS_FUNCTION = /(?:url|image(?:-set)?|cross-fade|element|paint|src|var)\s*\(/iu;
const UNSAFE_CSS_PROTOCOL = /(?:javascript|data|file|https?):/iu;
const UNSAFE_CSS_PROPERTY = /(?:^|[;{])\s*(?:behavior|-moz-binding)\s*:/iu;
const UNSAFE_PROTOCOL = /(?:javascript|data|file|https?):/iu;
const LOCAL_CSS_URL = /url\(\s*(?:"(#[A-Za-z_][A-Za-z0-9_.:-]*)"|'(#[A-Za-z_][A-Za-z0-9_.:-]*)'|(#[A-Za-z_][A-Za-z0-9_.:-]*))\s*\)/giu;
const LOCAL_SVG_URL = /^url\(\s*#[A-Za-z_][A-Za-z0-9_.:-]*\s*\)$/u;
const SESSION_DAG_CONTROLS_ACCESSIBLE_LABEL = "Dependency graph controls";
const SESSION_DAG_TRUSTED_CLASS_PREFIX = "session-dag-";
const SESSION_DAG_TRUSTED_ATTRIBUTE_PREFIX = "data-session-dag-";
export const SESSION_DAG_CURRENT_NODE_ATTRIBUTE = `${SESSION_DAG_TRUSTED_ATTRIBUTE_PREFIX}current`;

export const SESSION_DAG_SHADOW_STYLES = `
:host {
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.session-dag-svg-stack {
  position: relative;
  display: grid;
  width: 100%;
}
.session-dag-svg-stack > svg {
  grid-area: 1 / 1;
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  overflow: visible;
}
[data-session-dag-current="true"] > .label-container {
  fill: var(--bg-selected) !important;
  stroke: var(--accent) !important;
  stroke-width: 3px !important;
  stroke-linejoin: round;
}
.session-dag-control-layer {
  pointer-events: none;
  z-index: 1;
}
.session-dag-complete-control,
.session-dag-node-add-control,
.session-dag-go-to-control {
  color: var(--accent);
  cursor: pointer;
}
.session-dag-complete-control:focus,
.session-dag-node-add-control:focus,
.session-dag-go-to-control:focus {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.session-dag-complete-control-background,
.session-dag-node-add-control-background,
.session-dag-go-to-control-background {
  fill: var(--bg);
  stroke: currentColor;
  stroke-width: 1.8;
}
.session-dag-complete-control-check,
.session-dag-node-add-control-plus,
.session-dag-go-to-control-glyph {
  pointer-events: none;
}
.session-dag-complete-control:hover .session-dag-complete-control-background,
.session-dag-complete-control:focus .session-dag-complete-control-background,
.session-dag-node-add-control:hover .session-dag-node-add-control-background,
.session-dag-node-add-control:focus .session-dag-node-add-control-background,
.session-dag-go-to-control:hover .session-dag-go-to-control-background,
.session-dag-go-to-control:focus .session-dag-go-to-control-background {
  fill: var(--bg-selected);
}
.session-dag-complete-control[aria-disabled="true"],
.session-dag-node-add-control[aria-disabled="true"] {
  opacity: 0.55;
  cursor: wait;
}
.session-dag-edge-action-control {
  color: var(--accent);
}
.session-dag-edge-action-dot,
.session-dag-edge-action-button {
  cursor: pointer;
}
.session-dag-edge-action-dot:focus,
.session-dag-edge-action-button:focus {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.session-dag-edge-action-dot-hit {
  fill: transparent;
}
.session-dag-edge-action-dot-visible {
  fill: currentColor;
  stroke: var(--bg);
  stroke-width: 2;
}
.session-dag-edge-action-dot:hover .session-dag-edge-action-dot-visible,
.session-dag-edge-action-dot:focus .session-dag-edge-action-dot-visible {
  stroke: var(--text);
}
.session-dag-edge-action-button-background {
  fill: var(--bg);
  stroke: currentColor;
  stroke-width: 1.4;
}
.session-dag-edge-action-button-label {
  fill: currentColor;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  pointer-events: none;
  user-select: none;
}
.session-dag-edge-action-button:hover .session-dag-edge-action-button-background,
.session-dag-edge-action-button:focus .session-dag-edge-action-button-background {
  fill: var(--bg-selected);
}
.session-dag-edge-action-button[aria-disabled="true"] {
  opacity: 0.58;
  cursor: not-allowed;
}
.session-dag-edge-action-control[data-session-dag-pending="true"] {
  opacity: 0.68;
}
.session-dag-edge-action-control[data-session-dag-pending="true"] .session-dag-edge-action-dot,
.session-dag-edge-action-control[data-session-dag-pending="true"] .session-dag-edge-action-button {
  cursor: wait;
}
.session-dag-edge-insert-overlay-layer {
  position: relative;
  z-index: 2;
  grid-area: 1 / 1;
  min-width: 0;
  pointer-events: none;
}
.session-dag-edge-insert-form,
.session-dag-node-add-form {
  position: absolute;
  display: grid;
  gap: 7px;
  padding: 9px;
  transform: translate(-50%, 12px);
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-panel);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--bg) 55%, transparent);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
  pointer-events: all;
}
.session-dag-edge-insert-form {
  left: clamp(126px, var(--session-dag-insert-left), calc(100% - 126px));
  top: var(--session-dag-insert-top);
  width: min(240px, calc(100% - 16px));
}
.session-dag-node-add-form {
  left: clamp(146px, var(--session-dag-node-add-left), calc(100% - 146px));
  top: var(--session-dag-node-add-top);
  width: min(280px, calc(100% - 16px));
}
.session-dag-edge-insert-form[hidden],
.session-dag-node-add-form[hidden] {
  display: none;
}
.session-dag-edge-insert-form label,
.session-dag-node-add-form label {
  display: grid;
  gap: 4px;
}
.session-dag-edge-insert-form input,
.session-dag-node-add-form input {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  outline: none;
  background: var(--bg);
  color: var(--text);
  font: inherit;
}
.session-dag-edge-insert-form input:focus,
.session-dag-node-add-form input:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.session-dag-edge-insert-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.session-dag-node-add-actions {
  display: grid;
  gap: 6px;
}
.session-dag-edge-insert-form button,
.session-dag-node-add-form button {
  min-height: 28px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg);
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
}
.session-dag-node-add-actions button {
  text-align: left;
}
.session-dag-node-add-cancel {
  justify-self: end;
}
.session-dag-edge-insert-form button[type="submit"],
.session-dag-node-add-form button[type="submit"] {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  color: var(--accent);
}
.session-dag-edge-insert-form button:focus,
.session-dag-node-add-form button:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.session-dag-edge-insert-form[aria-busy="true"] input,
.session-dag-edge-insert-form button[aria-disabled="true"],
.session-dag-node-add-form[aria-busy="true"] input,
.session-dag-node-add-form button[aria-disabled="true"] {
  cursor: wait;
  opacity: 0.58;
}
`;

export type SessionDagSvgFailureStage = "root" | "safety" | "accessibility" | "sizing" | "aliases" | "controls";

export class SessionDagSvgError extends Error {
  readonly stage: SessionDagSvgFailureStage;

  constructor(stage: SessionDagSvgFailureStage, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SessionDagSvgError";
    this.stage = stage;
  }
}

export interface PreparedSessionDagSvg {
  svg: SVGSVGElement;
  nodeGroupsByAlias: Map<string, SVGGElement>;
  edgePathsByAlias: Map<string, SVGPathElement>;
}

export type SessionDagEdgeActionMode = "collapsed" | "actions" | "insert";

export interface SessionDagEdgeActionControl {
  root: SVGGElement;
  dot: SVGGElement;
  actions: SVGGElement;
  swap: SVGGElement;
  insert: SVGGElement;
}

export interface SessionDagRenderedEdgeAlias {
  dataAlias: string | null;
  pathId: string | null;
}

export interface SessionDagExpectedRenderedEdge {
  edgeAlias: string;
  selfNodeAlias: string | null;
}

export function hasReservedSessionDagClass(value: string): boolean {
  return value.split(/\s+/u).some((token) => (
    token.toLowerCase().startsWith(SESSION_DAG_TRUSTED_CLASS_PREFIX)
  ));
}

export function hasReservedSessionDagAttribute(name: string): boolean {
  return name.toLowerCase().startsWith(SESSION_DAG_TRUSTED_ATTRIBUTE_PREFIX);
}

export function hasNestedSessionDagStyleRules(styleRule: CSSStyleRule): boolean {
  const nestedRules = (styleRule as CSSStyleRule & { cssRules?: CSSRuleList }).cssRules;
  return Boolean(nestedRules?.length);
}

export function updateSessionDagCurrentNode(
  currentNode: SVGGElement | null,
  active: boolean,
  selectedSessionId: string | null,
  compiled: Pick<CompiledSessionDag, "aliasesBySessionId"> | null,
  prepared: Pick<PreparedSessionDagSvg, "nodeGroupsByAlias"> | null,
): SVGGElement | null {
  currentNode?.removeAttribute(SESSION_DAG_CURRENT_NODE_ATTRIBUTE);
  if (!active || !selectedSessionId || !compiled || !prepared) return null;

  const alias = compiled.aliasesBySessionId.get(selectedSessionId);
  const nextNode = alias ? prepared.nodeGroupsByAlias.get(alias) : undefined;
  if (!nextNode) return null;
  nextNode.setAttribute(SESSION_DAG_CURRENT_NODE_ATTRIBUTE, "true");
  return nextNode;
}

export function getSessionDagNodeAlias(
  dataAlias: string | null,
  groupId: string | null,
  renderId: string,
): string | null {
  let idAlias: string | null = null;
  if (groupId && /^n\d+$/u.test(groupId)) {
    idAlias = groupId;
  } else if (groupId) {
    const unprefixed = groupId.startsWith("flowchart-")
      ? groupId.slice("flowchart-".length)
      : null;
    const renderPrefix = `${renderId}-flowchart-`;
    const prefixed = groupId.startsWith(renderPrefix)
      ? groupId.slice(renderPrefix.length)
      : null;
    const match = /^(n\d+)-\d+$/u.exec(prefixed ?? unprefixed ?? "");
    idAlias = match?.[1] ?? null;
  }

  if (dataAlias !== null && idAlias !== null && dataAlias !== idAlias) {
    throw new SessionDagSvgError("aliases", "Mermaid output contains conflicting node aliases");
  }
  return dataAlias ?? idAlias;
}

export function getSessionDagEdgeAlias(
  dataAlias: string | null,
  pathId: string | null,
  renderId: string,
): string {
  const supportedAlias = dataAlias && (
    /^e\d+$/u.test(dataAlias)
    || /^n\d+-cyclic-special-(?:1|mid|2)$/u.test(dataAlias)
  );
  if (!supportedAlias || pathId !== `${renderId}-${dataAlias}`) {
    throw new SessionDagSvgError("aliases", "Mermaid output contains an unexpected edge alias");
  }
  return dataAlias;
}

export function validateSessionDagEdgeAliases(
  renderedEdges: readonly SessionDagRenderedEdgeAlias[],
  expectedEdges: readonly SessionDagExpectedRenderedEdge[],
  renderId: string,
): Map<string, number> {
  const expectedByRenderedAlias = new Map<string, { edgeAlias: string; midpoint: boolean }>();
  for (const expectedEdge of expectedEdges) {
    if (!/^e\d+$/u.test(expectedEdge.edgeAlias)
      || (expectedEdge.selfNodeAlias !== null && !/^n\d+$/u.test(expectedEdge.selfNodeAlias))) {
      throw new SessionDagSvgError("aliases", "The compiled graph contains an invalid edge alias");
    }
    const renderedAliases = expectedEdge.selfNodeAlias === null
      ? [{ alias: expectedEdge.edgeAlias, midpoint: true }]
      : [
          { alias: `${expectedEdge.selfNodeAlias}-cyclic-special-1`, midpoint: false },
          { alias: `${expectedEdge.selfNodeAlias}-cyclic-special-mid`, midpoint: true },
          { alias: `${expectedEdge.selfNodeAlias}-cyclic-special-2`, midpoint: false },
        ];
    for (const renderedAlias of renderedAliases) {
      if (expectedByRenderedAlias.has(renderedAlias.alias)) {
        throw new SessionDagSvgError("aliases", "The compiled graph contains duplicate edge aliases");
      }
      expectedByRenderedAlias.set(renderedAlias.alias, {
        edgeAlias: expectedEdge.edgeAlias,
        midpoint: renderedAlias.midpoint,
      });
    }
  }

  const seen = new Set<string>();
  const pathIndexesByEdgeAlias = new Map<string, number>();
  renderedEdges.forEach((renderedEdge, index) => {
    const renderedAlias = getSessionDagEdgeAlias(renderedEdge.dataAlias, renderedEdge.pathId, renderId);
    const expected = expectedByRenderedAlias.get(renderedAlias);
    if (!expected || seen.has(renderedAlias)) {
      throw new SessionDagSvgError("aliases", "Mermaid output contains an unexpected edge alias");
    }
    seen.add(renderedAlias);
    if (expected.midpoint) pathIndexesByEdgeAlias.set(expected.edgeAlias, index);
  });
  if (seen.size !== expectedByRenderedAlias.size
    || pathIndexesByEdgeAlias.size !== expectedEdges.length) {
    throw new SessionDagSvgError("aliases", "Mermaid output is missing a compiled edge alias");
  }
  return pathIndexesByEdgeAlias;
}

function directSvgChildren(root: SVGSVGElement, localName: string): SVGElement[] {
  return [...root.children].filter((child): child is SVGElement => (
    child.namespaceURI === SVG_NAMESPACE && child.localName === localName
  ));
}

function removeAllowedLocalCssUrls(
  value: string,
  allowedLocalReferenceIds: ReadonlySet<string> | undefined,
): string {
  if (!allowedLocalReferenceIds?.size) return value;
  return value.replace(
    LOCAL_CSS_URL,
    (
      match: string,
      doubleQuoted: string | undefined,
      singleQuoted: string | undefined,
      unquoted: string | undefined,
    ) => {
      const reference = doubleQuoted ?? singleQuoted ?? unquoted;
      return reference && allowedLocalReferenceIds.has(reference.slice(1)) ? "" : match;
    },
  );
}

export function hasUnsafeSessionDagCss(
  value: string,
  allowKeyframes = false,
  allowedLocalReferenceIds?: ReadonlySet<string>,
): boolean {
  if (value.includes("\\") || value.includes("/*") || value.includes("*/") || value.includes("//")) {
    return true;
  }
  const withoutAllowedLocalUrls = removeAllowedLocalCssUrls(value, allowedLocalReferenceIds);
  const withoutAllowedKeyframes = allowKeyframes
    ? withoutAllowedLocalUrls.replace(/@(?:-webkit-)?keyframes\b/giu, "")
    : withoutAllowedLocalUrls;
  return withoutAllowedKeyframes.includes("@")
    || UNSAFE_CSS_FUNCTION.test(withoutAllowedLocalUrls)
    || UNSAFE_CSS_PROTOCOL.test(withoutAllowedLocalUrls)
    || UNSAFE_CSS_PROPERTY.test(withoutAllowedLocalUrls)
    || /expression\s*\(/iu.test(withoutAllowedLocalUrls)
    || /:host|::part|::slotted/iu.test(withoutAllowedLocalUrls);
}

function assertSafeCssDeclarations(
  style: CSSStyleDeclaration,
  allowedLocalReferenceIds: ReadonlySet<string>,
): void {
  for (const propertyName of style) {
    const allowedReferencesForProperty = propertyName === "fill" || propertyName === "stroke"
      ? allowedLocalReferenceIds
      : undefined;
    if ((propertyName.startsWith("--") && propertyName !== "--mermaid-font-family")
      || propertyName === "behavior"
      || propertyName === "-moz-binding"
      || hasUnsafeSessionDagCss(style.getPropertyValue(propertyName), false, allowedReferencesForProperty)) {
      throw new SessionDagSvgError("safety", "Mermaid output contains unsafe SVG styling");
    }
  }
}

export function isSessionDagStyleSelectorScoped(selectorText: string, renderId: string): boolean {
  const rootSelector = `#${renderId}`;
  return selectorText.split(",").every((selectorPart) => {
    const selector = selectorPart.trim();
    const beginsAtRoot = selector === rootSelector
      || selector.startsWith(`${rootSelector} `)
      || selector.startsWith(`${rootSelector}>`)
      || selector.startsWith(`${rootSelector}.`)
      || selector.startsWith(`${rootSelector}:`)
      || selector.startsWith(`${rootSelector}[`);
    const selectorWithinRoot = selector.slice(rootSelector.length);
    const normalizedSelector = selectorWithinRoot.toLowerCase();
    return beginsAtRoot
      && !/[+~]/u.test(selectorWithinRoot)
      && !normalizedSelector.includes(SESSION_DAG_TRUSTED_CLASS_PREFIX)
      && !normalizedSelector.includes(SESSION_DAG_TRUSTED_ATTRIBUTE_PREFIX);
  });
}

function assertScopedStyleSheet(
  styleElement: SVGElement,
  renderId: string,
  allowedLocalReferenceIds: ReadonlySet<string>,
): void {
  const cssText = styleElement.textContent ?? "";
  if (hasUnsafeSessionDagCss(cssText, true, allowedLocalReferenceIds)) {
    throw new SessionDagSvgError("safety", "Mermaid output contains unsafe SVG styling");
  }
  const StyleSheet = styleElement.ownerDocument.defaultView?.CSSStyleSheet;
  if (!StyleSheet) {
    throw new SessionDagSvgError("safety", "SVG stylesheet validation is unavailable");
  }
  let sheet: CSSStyleSheet;
  try {
    sheet = new StyleSheet();
    sheet.replaceSync(cssText);
  } catch (error) {
    throw new SessionDagSvgError("safety", "Mermaid output contains invalid SVG styling", { cause: error });
  }
  if (cssText.trim() && sheet.cssRules.length === 0) {
    throw new SessionDagSvgError("safety", "Mermaid output contains invalid SVG styling");
  }

  for (const rule of sheet.cssRules) {
    if (rule.type === CSSRule.STYLE_RULE) {
      const styleRule = rule as CSSStyleRule;
      if (!isSessionDagStyleSelectorScoped(styleRule.selectorText, renderId)) {
        throw new SessionDagSvgError("safety", "Mermaid output contains unscoped SVG styling");
      }
      if (hasNestedSessionDagStyleRules(styleRule)) {
        throw new SessionDagSvgError("safety", "Mermaid output contains unsupported SVG styling");
      }
      assertSafeCssDeclarations(styleRule.style, allowedLocalReferenceIds);
      continue;
    }
    if (rule.type === CSSRule.KEYFRAMES_RULE) {
      const keyframesRule = rule as CSSKeyframesRule;
      for (const keyframeRule of keyframesRule.cssRules) {
        if (keyframeRule.type !== CSSRule.KEYFRAME_RULE) {
          throw new SessionDagSvgError("safety", "Mermaid output contains unsupported SVG styling");
        }
        assertSafeCssDeclarations((keyframeRule as CSSKeyframeRule).style, allowedLocalReferenceIds);
      }
      continue;
    }
    throw new SessionDagSvgError("safety", "Mermaid output contains unsupported SVG styling");
  }
}

function assertSafeSessionDagSvg(svg: SVGSVGElement, renderId: string): void {
  const styleElements = svg.querySelectorAll<SVGElement>("style");
  if (styleElements.length !== 1 || styleElements[0].parentNode !== svg) {
    throw new SessionDagSvgError("safety", "Mermaid output contains unexpected SVG styling");
  }

  const elements = [svg, ...svg.querySelectorAll<SVGElement>("*")];
  for (const element of elements) {
    if (element.namespaceURI !== SVG_NAMESPACE
      || FORBIDDEN_SVG_ELEMENTS.has(element.localName.toLowerCase())) {
      throw new SessionDagSvgError("safety", "Mermaid output contains unsupported SVG content");
    }
    for (const attribute of element.attributes) {
      const attributeName = attribute.name.toLowerCase();
      if (attributeName.startsWith("on")
        || attribute.localName === "href"
        || attribute.namespaceURI === XLINK_NAMESPACE
        || attributeName === "tabindex") {
        throw new SessionDagSvgError("safety", "Mermaid output contains interactive SVG content");
      }
      if (attribute.namespaceURI === XMLNS_NAMESPACE) continue;
      if (attribute.localName === "class" && hasReservedSessionDagClass(attribute.value)) {
        throw new SessionDagSvgError("safety", "Mermaid output contains a reserved SVG class");
      }
      if (hasReservedSessionDagAttribute(attribute.localName)) {
        throw new SessionDagSvgError("safety", "Mermaid output contains a reserved SVG attribute");
      }
      if (attribute.value.includes("\\")) {
        throw new SessionDagSvgError("safety", "Mermaid output contains escaped SVG content");
      }
      if (attribute.localName === "style") {
        if (hasUnsafeSessionDagCss(attribute.value)) {
          throw new SessionDagSvgError("safety", "Mermaid output contains unsafe SVG styling");
        }
      } else if (attribute.value.toLowerCase().includes("url(")) {
        if (!LOCAL_SVG_URL.test(attribute.value)) {
          throw new SessionDagSvgError("safety", "Mermaid output contains an external SVG reference");
        }
      } else if (UNSAFE_PROTOCOL.test(attribute.value)) {
        throw new SessionDagSvgError("safety", "Mermaid output contains an external SVG reference");
      }
    }
  }

  const expectedGradientId = `${renderId}-gradient`;
  const expectedGradientElements = elements.filter((element) => element.getAttribute("id") === expectedGradientId);
  const allowedLocalReferenceIds = new Set<string>();
  if (expectedGradientElements.length > 0) {
    if (expectedGradientElements.length !== 1
      || expectedGradientElements[0].localName.toLowerCase() !== "lineargradient") {
      throw new SessionDagSvgError("safety", "Mermaid output contains an invalid local SVG reference");
    }
    allowedLocalReferenceIds.add(expectedGradientId);
  }
  assertScopedStyleSheet(styleElements[0], renderId, allowedLocalReferenceIds);
}

export function prepareSessionDagSvg(
  svgMarkup: string,
  compiled: CompiledSessionDag,
  ownerDocument: Document,
  renderId: string,
): PreparedSessionDagSvg {
  const Parser = ownerDocument.defaultView?.DOMParser
    ?? (typeof DOMParser === "undefined" ? null : DOMParser);
  if (!Parser) throw new SessionDagSvgError("root", "SVG parsing is unavailable");
  const parsedDocument = new Parser().parseFromString(svgMarkup, "image/svg+xml");
  if (parsedDocument.doctype) {
    throw new SessionDagSvgError("root", "Mermaid output must not contain a document type");
  }
  const parsedRoot = parsedDocument.documentElement;
  if (parsedRoot.namespaceURI !== SVG_NAMESPACE || parsedRoot.localName !== "svg") {
    throw new SessionDagSvgError("root", "Mermaid output must contain exactly one SVG root");
  }
  const svg = ownerDocument.importNode(parsedRoot, true) as unknown as SVGSVGElement;
  if (svg.getAttribute("id") !== renderId) {
    throw new SessionDagSvgError("root", "Mermaid output root does not match the current render");
  }
  assertSafeSessionDagSvg(svg, renderId);

  const titles = directSvgChildren(svg, "title");
  const descriptions = directSvgChildren(svg, "desc");
  if (titles.length !== 1 || descriptions.length !== 1
    || titles[0].textContent !== SESSION_DAG_ACCESSIBLE_TITLE
    || descriptions[0].textContent !== SESSION_DAG_ACCESSIBLE_DESCRIPTION) {
    throw new SessionDagSvgError("accessibility", "Mermaid output accessibility metadata is invalid");
  }
  const accessiblePrefix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `session-dag-${crypto.randomUUID()}`
    : `session-dag-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const titleId = `${accessiblePrefix}-title`;
  const descriptionId = `${accessiblePrefix}-description`;
  titles[0].setAttribute("id", titleId);
  descriptions[0].setAttribute("id", descriptionId);
  // Keep the validated graph named independently from the trusted sibling SVG
  // that exposes completion controls.
  svg.setAttribute("role", "group");
  svg.removeAttribute("aria-label");
  svg.setAttribute("aria-labelledby", titleId);
  svg.setAttribute("aria-describedby", descriptionId);
  svg.removeAttribute("aria-roledescription");

  const sizing = getMermaidResponsiveSizing(svg.getAttribute("viewBox"));
  if (!sizing) throw new SessionDagSvgError("sizing", "Mermaid output has invalid SVG geometry");
  svg.setAttribute("width", sizing.width);
  svg.style.setProperty("width", sizing.width);
  svg.style.setProperty("max-width", sizing.maxWidth);
  svg.style.setProperty("height", sizing.height);

  const nodeGroupsByAlias = new Map<string, SVGGElement>();
  const nodeGroups = svg.querySelectorAll<SVGGElement>("g.node");
  for (const group of nodeGroups) {
    const alias = getSessionDagNodeAlias(
      group.getAttribute("data-id"),
      group.getAttribute("id"),
      renderId,
    );
    if (!alias || !compiled.sessionIdsByAlias.has(alias) || nodeGroupsByAlias.has(alias)) {
      throw new SessionDagSvgError("aliases", "Mermaid output contains an unexpected node alias");
    }
    nodeGroupsByAlias.set(alias, group);
  }
  if (nodeGroupsByAlias.size !== compiled.sessionIdsByAlias.size) {
    throw new SessionDagSvgError("aliases", "Mermaid output is missing a compiled node alias");
  }

  for (const [alias, group] of nodeGroupsByAlias) {
    const sessionId = compiled.sessionIdsByAlias.get(alias)!;
    const tooltip = ownerDocument.createElementNS(SVG_NAMESPACE, "title");
    tooltip.textContent = sessionId;
    group.insertBefore(tooltip, group.firstChild);
    // The original Mermaid node has no listener or focus target, but it remains
    // pointer-visible so its native title tooltip can expose the exact ID.
    group.setAttribute("data-session-dag-alias", alias);
  }

  const edgePathGroups = svg.querySelectorAll<SVGGElement>("g.edgePaths");
  if (edgePathGroups.length !== 1) {
    throw new SessionDagSvgError("aliases", "Mermaid output contains unexpected edge structure");
  }
  const renderedEdgePaths = [...edgePathGroups[0].children];
  const edgeCandidates = [...svg.querySelectorAll<SVGElement>("[data-edge], [data-et]")];
  if (renderedEdgePaths.length !== edgeCandidates.length
    || renderedEdgePaths.some((element) => (
      element.namespaceURI !== SVG_NAMESPACE
      || element.localName !== "path"
      || element.getAttribute("data-edge") !== "true"
      || element.getAttribute("data-et") !== "edge"
    ))
    || edgeCandidates.some((element) => element.parentNode !== edgePathGroups[0])) {
    throw new SessionDagSvgError("aliases", "Mermaid output contains unexpected edge structure");
  }
  const expectedRenderedEdges: SessionDagExpectedRenderedEdge[] = [];
  for (const [edgeAlias, edge] of compiled.edgesByAlias) {
    const selfNodeAlias = edge.fromSessionId === edge.toSessionId
      ? compiled.aliasesBySessionId.get(edge.fromSessionId)
      : null;
    if (edge.fromSessionId === edge.toSessionId && !selfNodeAlias) {
      throw new SessionDagSvgError("aliases", "A self-edge node is missing from the compiled graph");
    }
    expectedRenderedEdges.push({ edgeAlias, selfNodeAlias: selfNodeAlias ?? null });
  }
  // Mermaid 11.15 expands a self-edge into three deterministic path segments
  // named from the generated node alias. Validate all three and retain only the
  // middle segment as that compiled edge's control-position path.
  const renderedEdgeDescriptors = renderedEdgePaths.map((element) => ({
    dataAlias: element.getAttribute("data-id"),
    pathId: element.getAttribute("id"),
  }));
  const pathIndexesByEdgeAlias = validateSessionDagEdgeAliases(
    renderedEdgeDescriptors,
    expectedRenderedEdges,
    renderId,
  );
  const elementIdCounts = new Map<string, number>();
  for (const element of [svg, ...svg.querySelectorAll<SVGElement>("[id]")]) {
    const id = element.getAttribute("id");
    if (id) elementIdCounts.set(id, (elementIdCounts.get(id) ?? 0) + 1);
  }
  for (const descriptor of renderedEdgeDescriptors) {
    if (!descriptor.dataAlias
      || elementIdCounts.get(`${renderId}-${descriptor.dataAlias}`) !== 1) {
      throw new SessionDagSvgError("aliases", "Mermaid output contains an unexpected edge alias");
    }
  }
  const edgePathsByAlias = new Map<string, SVGPathElement>();
  for (const [edgeAlias, index] of pathIndexesByEdgeAlias) {
    edgePathsByAlias.set(edgeAlias, renderedEdgePaths[index] as SVGPathElement);
  }

  return { svg, nodeGroupsByAlias, edgePathsByAlias };
}

export function createSessionDagControlLayer(
  ownerDocument: Document,
  graphSvg: SVGSVGElement,
): SVGSVGElement {
  const viewBox = graphSvg.getAttribute("viewBox");
  if (!viewBox) throw new SessionDagSvgError("controls", "The rendered graph has no control geometry");

  const layer = ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
  layer.setAttribute("class", "session-dag-control-layer");
  layer.setAttribute("viewBox", viewBox);
  const preserveAspectRatio = graphSvg.getAttribute("preserveAspectRatio");
  if (preserveAspectRatio) layer.setAttribute("preserveAspectRatio", preserveAspectRatio);
  layer.setAttribute("width", "100%");
  layer.style.setProperty("width", "100%");
  layer.style.setProperty("max-width", graphSvg.style.maxWidth || "100%");
  layer.style.setProperty("height", "auto");
  layer.setAttribute("role", "group");
  layer.setAttribute("aria-label", SESSION_DAG_CONTROLS_ACCESSIBLE_LABEL);
  return layer;
}

export function getSessionDagControlPosition(
  element: SVGGraphicsElement,
  graphSvg: SVGSVGElement,
  localX: number,
  localY: number,
): { x: number; y: number } {
  const elementMatrix = element.getScreenCTM();
  const graphMatrix = graphSvg.getScreenCTM();
  if (!elementMatrix || !graphMatrix || !Number.isFinite(localX) || !Number.isFinite(localY)) {
    throw new SessionDagSvgError("controls", "A graph control has invalid geometry");
  }

  let inverseGraphMatrix: DOMMatrix;
  try {
    inverseGraphMatrix = graphMatrix.inverse();
  } catch (error) {
    throw new SessionDagSvgError("controls", "A graph control has invalid geometry", { cause: error });
  }
  const screenX = elementMatrix.a * localX + elementMatrix.c * localY + elementMatrix.e;
  const screenY = elementMatrix.b * localX + elementMatrix.d * localY + elementMatrix.f;
  const x = inverseGraphMatrix.a * screenX + inverseGraphMatrix.c * screenY + inverseGraphMatrix.e;
  const y = inverseGraphMatrix.b * screenX + inverseGraphMatrix.d * screenY + inverseGraphMatrix.f;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new SessionDagSvgError("controls", "A graph control has invalid geometry");
  }
  return { x, y };
}

export function getSessionDagGoToControlLocalPosition(
  bounds: Pick<DOMRect, "x" | "y" | "width" | "height">,
  direction: SessionDagDirection,
): { x: number; y: number } {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width < 22 || bounds.height < 22) {
    throw new SessionDagSvgError("controls", "An active node has invalid go-to geometry");
  }
  // Keep the control on the bottom-right quarter of the node boundary. Moving
  // along the boundary, rather than into its label or the exact corner, leaves
  // room around Mermaid's direction-dependent edge fan-out and self-edge loop.
  const horizontalFraction = direction === "TD" ? 0.75 : 0.8;
  return {
    x: bounds.x + bounds.width * horizontalFraction,
    y: bounds.y + bounds.height - 1,
  };
}

export function validateSessionDagNodeControlGeometry(
  bounds: Pick<DOMRect, "x" | "y" | "width" | "height">,
  direction: SessionDagDirection,
  eligible: boolean,
  available: boolean,
): void {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width < 22 || bounds.height < 22) {
    throw new SessionDagSvgError("controls", "An active node has invalid control geometry");
  }

  const positions = [{ x: bounds.x + 11, y: bounds.y + 11 }];
  if (eligible) {
    positions.push({ x: bounds.x + bounds.width - 11, y: bounds.y + 11 });
  }
  if (available) {
    positions.push(getSessionDagGoToControlLocalPosition(bounds, direction));
  }
  for (let index = 0; index < positions.length; index += 1) {
    for (let other = index + 1; other < positions.length; other += 1) {
      if (Math.hypot(
        positions[index].x - positions[other].x,
        positions[index].y - positions[other].y,
      ) < 20) {
        throw new SessionDagSvgError("controls", "Active node controls would overlap");
      }
    }
  }
}

export function getSessionDagEdgeMidpoint(
  edgePath: SVGPathElement,
  graphSvg: SVGSVGElement,
): { x: number; y: number } {
  let length: number;
  let midpoint: DOMPoint;
  try {
    length = edgePath.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) {
      throw new SessionDagSvgError("controls", "An edge has invalid control geometry");
    }
    midpoint = edgePath.getPointAtLength(length / 2);
  } catch (error) {
    if (error instanceof SessionDagSvgError) throw error;
    throw new SessionDagSvgError("controls", "An edge has invalid control geometry", { cause: error });
  }
  if (!Number.isFinite(midpoint.x) || !Number.isFinite(midpoint.y)) {
    throw new SessionDagSvgError("controls", "An edge has invalid control geometry");
  }
  return getSessionDagControlPosition(edgePath, graphSvg, midpoint.x, midpoint.y);
}

export function createSessionDagCompleteControl(
  ownerDocument: Document,
  label: string,
): SVGGElement {
  const control = ownerDocument.createElementNS(SVG_NAMESPACE, "g");
  control.setAttribute("class", "session-dag-complete-control");
  control.setAttribute("role", "button");
  control.setAttribute("tabindex", "0");
  control.setAttribute("aria-label", `Complete ${label}`);
  control.setAttribute("pointer-events", "all");

  const circle = ownerDocument.createElementNS(SVG_NAMESPACE, "circle");
  circle.setAttribute("r", "9");
  circle.setAttribute("cx", "0");
  circle.setAttribute("cy", "0");
  circle.setAttribute("class", "session-dag-complete-control-background");
  control.appendChild(circle);

  const check = ownerDocument.createElementNS(SVG_NAMESPACE, "path");
  check.setAttribute("d", "M -4 0 L -1 3 L 5 -4");
  check.setAttribute("class", "session-dag-complete-control-check");
  check.setAttribute("fill", "none");
  check.setAttribute("stroke", "currentColor");
  check.setAttribute("stroke-width", "2");
  check.setAttribute("stroke-linecap", "round");
  check.setAttribute("stroke-linejoin", "round");
  control.appendChild(check);

  return control;
}

export function createSessionDagNodeAddControl(
  ownerDocument: Document,
  label: string,
): SVGGElement {
  const control = ownerDocument.createElementNS(SVG_NAMESPACE, "g");
  control.setAttribute("class", "session-dag-node-add-control");
  control.setAttribute("role", "button");
  control.setAttribute("tabindex", "0");
  control.setAttribute("aria-expanded", "false");
  control.setAttribute("aria-label", `Add dependency connected to ${label}`);
  control.setAttribute("pointer-events", "all");

  const circle = ownerDocument.createElementNS(SVG_NAMESPACE, "circle");
  circle.setAttribute("r", "9");
  circle.setAttribute("cx", "0");
  circle.setAttribute("cy", "0");
  circle.setAttribute("class", "session-dag-node-add-control-background");
  control.appendChild(circle);

  const plus = ownerDocument.createElementNS(SVG_NAMESPACE, "path");
  plus.setAttribute("d", "M -4 0 H 4 M 0 -4 V 4");
  plus.setAttribute("class", "session-dag-node-add-control-plus");
  plus.setAttribute("fill", "none");
  plus.setAttribute("stroke", "currentColor");
  plus.setAttribute("stroke-width", "2");
  plus.setAttribute("stroke-linecap", "round");
  control.appendChild(plus);

  return control;
}

export function createSessionDagGoToControl(
  ownerDocument: Document,
  label: string,
): SVGGElement {
  const control = ownerDocument.createElementNS(SVG_NAMESPACE, "g");
  control.setAttribute("class", "session-dag-go-to-control");
  control.setAttribute("role", "button");
  control.setAttribute("tabindex", "0");
  control.setAttribute("aria-label", `Go to session ${label}`);
  control.setAttribute("pointer-events", "all");

  const circle = ownerDocument.createElementNS(SVG_NAMESPACE, "circle");
  circle.setAttribute("r", "9");
  circle.setAttribute("cx", "0");
  circle.setAttribute("cy", "0");
  circle.setAttribute("class", "session-dag-go-to-control-background");
  control.appendChild(circle);

  const glyph = ownerDocument.createElementNS(SVG_NAMESPACE, "path");
  glyph.setAttribute("d", "M -5 0 H 2 M -1 -3 L 2 0 L -1 3 M 5 -5 V 5");
  glyph.setAttribute("class", "session-dag-go-to-control-glyph");
  glyph.setAttribute("fill", "none");
  glyph.setAttribute("stroke", "currentColor");
  glyph.setAttribute("stroke-width", "1.8");
  glyph.setAttribute("stroke-linecap", "round");
  glyph.setAttribute("stroke-linejoin", "round");
  control.appendChild(glyph);

  return control;
}

function createSessionDagEdgeActionButton(
  ownerDocument: Document,
  className: string,
  accessibleLabel: string,
  text: string,
  centerX: number,
  centerY: number,
  disabled: boolean,
): SVGGElement {
  const button = ownerDocument.createElementNS(SVG_NAMESPACE, "g");
  button.setAttribute("class", `session-dag-edge-action-button ${className}`);
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "-1");
  button.setAttribute("aria-label", accessibleLabel);
  button.setAttribute("pointer-events", "all");
  if (disabled) button.setAttribute("aria-disabled", "true");

  const background = ownerDocument.createElementNS(SVG_NAMESPACE, "rect");
  background.setAttribute("x", String(centerX - 24));
  background.setAttribute("y", String(centerY - 11));
  background.setAttribute("width", "48");
  background.setAttribute("height", "22");
  background.setAttribute("rx", "6");
  background.setAttribute("class", "session-dag-edge-action-button-background");
  button.appendChild(background);

  const label = ownerDocument.createElementNS(SVG_NAMESPACE, "text");
  label.setAttribute("x", String(centerX));
  label.setAttribute("y", String(centerY));
  label.setAttribute("dy", "0.32em");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("class", "session-dag-edge-action-button-label");
  label.textContent = text;
  button.appendChild(label);
  return button;
}

export function createSessionDagEdgeActionControl(
  ownerDocument: Document,
  fromLabel: string,
  toLabel: string,
  selfEdge: boolean,
  direction: SessionDagDirection,
): SessionDagEdgeActionControl {
  const root = ownerDocument.createElementNS(SVG_NAMESPACE, "g");
  root.setAttribute("class", "session-dag-edge-action-control");
  root.setAttribute("pointer-events", "all");

  const dot = ownerDocument.createElementNS(SVG_NAMESPACE, "g");
  dot.setAttribute("class", "session-dag-edge-action-dot");
  dot.setAttribute("role", "button");
  dot.setAttribute("tabindex", "0");
  dot.setAttribute("aria-expanded", "false");
  dot.setAttribute("aria-label", `Show actions for dependency from ${fromLabel} to ${toLabel}`);
  dot.setAttribute("pointer-events", "all");

  const hitTarget = ownerDocument.createElementNS(SVG_NAMESPACE, "circle");
  hitTarget.setAttribute("r", "14");
  hitTarget.setAttribute("class", "session-dag-edge-action-dot-hit");
  dot.appendChild(hitTarget);
  const visibleDot = ownerDocument.createElementNS(SVG_NAMESPACE, "circle");
  visibleDot.setAttribute("r", "5");
  visibleDot.setAttribute("class", "session-dag-edge-action-dot-visible");
  dot.appendChild(visibleDot);
  root.appendChild(dot);

  const actions = ownerDocument.createElementNS(SVG_NAMESPACE, "g");
  actions.setAttribute("class", "session-dag-edge-action-buttons");
  actions.setAttribute("aria-hidden", "true");
  actions.setAttribute("display", "none");
  const horizontalFlow = direction === "LR";
  const swap = createSessionDagEdgeActionButton(
    ownerDocument,
    "session-dag-edge-action-swap",
    `Swap dependency from ${fromLabel} to ${toLabel}`,
    "Swap",
    horizontalFlow ? 0 : -40,
    horizontalFlow ? -28 : 0,
    selfEdge,
  );
  const insert = createSessionDagEdgeActionButton(
    ownerDocument,
    "session-dag-edge-action-insert",
    `Insert a session into dependency from ${fromLabel} to ${toLabel}`,
    "Insert",
    horizontalFlow ? 0 : 40,
    horizontalFlow ? 28 : 0,
    false,
  );
  actions.appendChild(swap);
  actions.appendChild(insert);
  root.appendChild(actions);

  return { root, dot, actions, swap, insert };
}

export function updateSessionDagEdgeActionControl(
  control: SessionDagEdgeActionControl,
  mode: SessionDagEdgeActionMode,
  pending: boolean,
): void {
  const expanded = mode !== "collapsed";
  control.dot.setAttribute("aria-expanded", String(expanded));
  control.dot.setAttribute("tabindex", pending ? "-1" : "0");
  if (pending) control.root.setAttribute("data-session-dag-pending", "true");
  else control.root.removeAttribute("data-session-dag-pending");

  const showActions = mode === "actions";
  control.actions.setAttribute("aria-hidden", String(!showActions));
  if (showActions) control.actions.removeAttribute("display");
  else control.actions.setAttribute("display", "none");
  control.swap.setAttribute(
    "tabindex",
    showActions && !pending && control.swap.getAttribute("aria-disabled") !== "true" ? "0" : "-1",
  );
  control.insert.setAttribute("tabindex", showActions && !pending ? "0" : "-1");
}

export function shouldDeferSessionDagNodeFocusRestore(
  previewActive: boolean,
  authorityAdopted: boolean,
  currentControlAvailable: boolean,
  currentControlIsSettledControl: boolean,
): boolean {
  return previewActive
    && (!currentControlAvailable || (authorityAdopted && currentControlIsSettledControl));
}

export function getSessionDagOverlayPosition(
  graphSvg: SVGSVGElement,
  graphX: number,
  graphY: number,
): { leftPercent: number; topPercent: number } {
  const values = graphSvg.getAttribute("viewBox")?.trim().split(/[\s,]+/u).map(Number);
  if (!values || values.length !== 4 || !values.every(Number.isFinite)) {
    throw new SessionDagSvgError("controls", "The rendered graph has invalid overlay geometry");
  }
  const [minimumX, minimumY, width, height] = values;
  if (width <= 0 || height <= 0 || !Number.isFinite(graphX) || !Number.isFinite(graphY)
    || graphX < minimumX || graphX > minimumX + width
    || graphY < minimumY || graphY > minimumY + height) {
    throw new SessionDagSvgError("controls", "The rendered graph has invalid overlay geometry");
  }
  return {
    leftPercent: ((graphX - minimumX) / width) * 100,
    topPercent: ((graphY - minimumY) / height) * 100,
  };
}
