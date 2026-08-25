import { getMermaidResponsiveSizing } from "./mermaid-display";
import {
  SESSION_DAG_ACCESSIBLE_DESCRIPTION,
  SESSION_DAG_ACCESSIBLE_TITLE,
  type CompiledSessionDag,
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
.session-dag-complete-control {
  color: var(--accent);
  cursor: pointer;
}
.session-dag-complete-control:focus {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.session-dag-complete-control-background {
  fill: var(--bg);
  stroke: currentColor;
  stroke-width: 1.8;
}
.session-dag-complete-control-check {
  pointer-events: none;
}
.session-dag-complete-control:hover .session-dag-complete-control-background,
.session-dag-complete-control:focus .session-dag-complete-control-background {
  fill: var(--bg-selected);
}
.session-dag-complete-control[aria-disabled="true"] {
  opacity: 0.55;
  cursor: wait;
}
.session-dag-swap-control {
  color: var(--accent);
  cursor: pointer;
}
.session-dag-swap-control:focus {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.session-dag-swap-control-background {
  fill: var(--bg);
  stroke: currentColor;
  stroke-width: 1.4;
}
.session-dag-swap-control-label {
  fill: currentColor;
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 600;
  pointer-events: none;
  user-select: none;
}
.session-dag-swap-control:hover .session-dag-swap-control-background,
.session-dag-swap-control:focus .session-dag-swap-control-background {
  fill: var(--bg-selected);
}
.session-dag-swap-control[aria-disabled="true"] {
  opacity: 0.58;
  cursor: not-allowed;
}
.session-dag-swap-control[data-session-dag-pending="true"] {
  cursor: wait;
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

export function createSessionDagSwapControl(
  ownerDocument: Document,
  fromLabel: string,
  toLabel: string,
  disabled: boolean,
): SVGGElement {
  const control = ownerDocument.createElementNS(SVG_NAMESPACE, "g");
  control.setAttribute("class", "session-dag-swap-control");
  control.setAttribute("role", "button");
  control.setAttribute("tabindex", disabled ? "-1" : "0");
  control.setAttribute("aria-label", `Swap dependency from ${fromLabel} to ${toLabel}`);
  control.setAttribute("pointer-events", "all");
  if (disabled) control.setAttribute("aria-disabled", "true");

  const background = ownerDocument.createElementNS(SVG_NAMESPACE, "rect");
  background.setAttribute("x", "-17");
  background.setAttribute("y", "-9");
  background.setAttribute("width", "34");
  background.setAttribute("height", "18");
  background.setAttribute("rx", "5");
  background.setAttribute("class", "session-dag-swap-control-background");
  control.appendChild(background);

  const label = ownerDocument.createElementNS(SVG_NAMESPACE, "text");
  label.setAttribute("x", "0");
  label.setAttribute("y", "0");
  label.setAttribute("dy", "0.32em");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("class", "session-dag-swap-control-label");
  label.textContent = "Swap";
  control.appendChild(label);

  return control;
}
