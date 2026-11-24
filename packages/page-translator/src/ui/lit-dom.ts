const SHOW_ELEMENT_AND_COMMENT = 129;

interface DelegatingWalker {
  currentNode: Node | null;
  nextNode: () => Node | null;
}

let activeDoc: Document | null = null;
let innerWalker: TreeWalker | null = null;
let trackedNode: Node | null = null;
let installedShim = false;

function requireActiveDoc(): Document {
  if (!activeDoc) {
    throw new Error(
      "Lit DOM creation scope is not initialized; render via lit-render helpers."
    );
  }
  return activeDoc;
}

const delegatingWalker: DelegatingWalker = {
  get currentNode(): Node | null {
    return innerWalker ? innerWalker.currentNode : trackedNode;
  },
  set currentNode(node: Node | null) {
    trackedNode = node;
    if (node && node !== (delegatingDoc as unknown as Node) && activeDoc) {
      innerWalker = activeDoc.createTreeWalker(node, SHOW_ELEMENT_AND_COMMENT);
    } else {
      innerWalker = null;
    }
  },
  nextNode(): Node | null {
    return innerWalker ? innerWalker.nextNode() : null;
  },
};

const delegatingDoc = {
  createComment(data: string): Comment {
    return requireActiveDoc().createComment(data);
  },
  createElement(tagName: string): HTMLElement {
    return requireActiveDoc().createElement(tagName);
  },
  createTextNode(data: string): Text {
    return requireActiveDoc().createTextNode(data);
  },
  createTreeWalker(): DelegatingWalker {
    return delegatingWalker;
  },
  importNode<T extends Node>(node: T, deep?: boolean): T {
    return requireActiveDoc().importNode(node, deep);
  },
};

if (typeof globalThis.document === "undefined") {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    enumerable: true,
    value: delegatingDoc,
    writable: true,
  });
  installedShim = true;
}

export function setLitCreationScope(doc: Document): void {
  activeDoc = doc;
}

export function cleanupLitDomGlobal(): void {
  if (
    installedShim &&
    (globalThis as { document?: unknown }).document === delegatingDoc
  ) {
    Reflect.deleteProperty(globalThis, "document");
    installedShim = false;
  }
}
