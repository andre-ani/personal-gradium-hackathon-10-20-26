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
    stroke: primary ? '#174a9c' : '#456b9c',
    lineWidth: primary ? 4 : 2.7,
    strokeOpacity: primary ? 0.95 : 0.65,
    lineDash: [],
    endArrow: true,
  };
}
