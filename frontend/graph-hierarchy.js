// Presentation roles come from relationships, never from guessing at labels.
export function classifyGraphHierarchy(nodes, edges) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const incoming = new Set(edges.filter(edge => edge.source !== edge.target).map(edge => edge.target));
  let roots = nodes.filter(node => node.kind === 'root' || node.nodeVariant === 'anchor');
  if (!roots.length) roots = nodes.filter(node => !incoming.has(node.id));
  if (!roots.length && nodes.length) roots = [nodes[0]];
  const main = new Set(roots.map(node => node.id));
  const rootIds = new Set(main);
  for (const edge of edges) if (rootIds.has(edge.source) && byId.has(edge.target)) main.add(edge.target);
  const nodeRoles = new Map(nodes.map(node => [node.id,
    node.topicRole === 'main' || (!node.topicRole && main.has(node.id)) ? 'main' : 'supporting',
  ]));
  const edgeRoles = new Map(edges.map(edge => [edge.id,
    nodeRoles.get(edge.source) === 'main' && nodeRoles.get(edge.target) === 'main' ? 'primary' : 'supporting',
  ]));
  return { nodeRoles, edgeRoles };
}

export function paperEdgeStyle(role) {
  const primary = role === 'primary';
  return {
    edgeRole: primary ? 'primary' : 'supporting',
    stroke: primary ? '#123f85' : '#37597f',
    lineWidth: primary ? 4 : 2.7,
    // Slightly translucent ink so the paper grain shows through.
    strokeOpacity: primary ? 0.85 : 0.78,
    lineDash: [],
    endArrow: true,
    // Above the cards, so each arrowhead reads on top of the card it lands in.
    zIndex: 1,
  };
}
