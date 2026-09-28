export interface TreeNode {
  name: string;
  fullPath: string;
  vpath: string;
  type: 'folder' | 'file';
  id?: string;
  fileType?: 'text' | 'image';
  children: TreeNode[];
}

export function buildFileTree(files: { name: string; vpath: string; id: string; type: 'text' | 'image' }[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const segments = file.name.split('/').filter(Boolean);
    let currentLevel = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isFile = i === segments.length - 1;
      const fullPath = segments.slice(0, i + 1).join('/');

      if (isFile) {
        currentLevel.push({
          name: segment,
          fullPath,
          vpath: file.vpath,
          type: 'file',
          id: file.id,
          fileType: file.type,
          children: [],
        });
      } else {
        let folder = currentLevel.find(n => n.type === 'folder' && n.name === segment);
        if (!folder) {
          folder = {
            name: segment,
            fullPath,
            vpath: '',
            type: 'folder',
            children: [],
          };
          currentLevel.push(folder);
        }
        currentLevel = folder.children;
      }
    }
  }

  return sortTree(root);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  }).map(node => {
    if (node.type === 'folder') {
      return { ...node, children: sortTree(node.children) };
    }
    return node;
  });
}

export function searchTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) return nodes;

  const lower = query.toLowerCase();
  const result: TreeNode[] = [];

  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.name.toLowerCase().includes(lower) || node.fullPath.toLowerCase().includes(lower)) {
        result.push(node);
      }
    } else {
      const matchingChildren = searchTree(node.children, query);
      if (matchingChildren.length > 0 || node.name.toLowerCase().includes(lower)) {
        result.push({ ...node, children: matchingChildren });
      }
    }
  }

  return result;
}

export function countFiles(nodes: TreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'file') count++;
    else count += countFiles(node.children);
  }
  return count;
}
