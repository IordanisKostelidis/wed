/**
 * Editing menu manager.
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */
import { Action } from "../action";
import { CaretManager } from "../caret-manager";
import { DLoc } from "../dloc";
import { isElement } from "../domtypeguards";
import { closestByClass, htmlToElements, indexOf,
         isNotDisplayed } from "../domutil";
import { Mode } from "../mode";
import { Transformation, TransformationData } from "../transformation";
import { Editor } from "../wed";
import { ActionContextMenu, Item } from "./action-context-menu";
import { CompletionMenu } from "./completion-menu";
import { ContextMenu } from "./context-menu";
import { makeHTML } from "./icon";

const atStartToTxt: Record<string, string> = {
  undefined: "",
  true: " before this element",
  false: " after this element",
};

/**
 * Manages the editing menus for a specific editing view. An "editing menu" is a
 * menu that appears in the editing pane. The context menu and completion menu
 * are editing menus.
 *
 * Only one editing menu may be shown at any given time.
 */
export class EditingMenuManager {
  private readonly caretManager: CaretManager;
  private readonly guiRoot: HTMLDocument | HTMLElement;
  private readonly dataRoot: Document | Element;
  private currentDropdown: ContextMenu | undefined;
  private readonly mode: Mode<{}>;
  private readonly doc: HTMLDocument;

  /**
   * @param editor The editor for which the manager is created.
   */
  constructor(private readonly editor: Editor) {
    this.caretManager = editor.caretManager;
    this.mode = editor.mode;
    this.guiRoot = editor.gui_root;
    this.dataRoot = editor.data_root;
    this.doc = this.guiRoot.ownerDocument;
  }

  /**
   * This is the default menu handler called when the user right-clicks in the
   * contents of a document or uses the keyboard shortcut.
   *
   * The menu handler which is invoked when a user right-clicks on an element
   * start or end label is defined by the decorator that the mode is using.
   */
  contextMenuHandler(e: JQueryEventObject): boolean {
    const sel = this.caretManager.sel;
    if (sel === undefined || (!sel.collapsed && !sel.wellFormed)) {
      return false;
    }

    let node = sel.focus.node;
    let offset = sel.focus.offset;
    if (!isElement(node)) {
      const parent = node.parentNode;
      if (parent === null) {
        throw new Error("contextMenuHandler invoked on detached node");
      }
      offset = indexOf(parent.childNodes, node);
      node = parent;
    }

    // Move out of any placeholder
    const ph = closestByClass(node, "_placeholder", this.guiRoot);
    if (ph !== null) {
      const parent = ph.parentNode;
      if (parent === null) {
        throw new Error("contextMenuHandler invoked on detached node");
      }
      offset = indexOf(parent.childNodes, ph);
      node = parent;
    }

    const real = closestByClass(node, "_real", this.guiRoot);
    const readonly = real !== null && real.classList.contains("_readonly");
    const method =
      closestByClass(node, "_attribute_value", this.guiRoot) !== null ?
      this.getMenuItemsForAttribute :
      this.getMenuItemsForElement;

    const menuItems = method.call(this, node, offset, !sel.collapsed);

    // There's no menu to display, so let the event bubble up.
    if (menuItems.length === 0) {
      return true;
    }

    const pos = this.computeMenuPosition(e);
    this.displayContextMenu(ActionContextMenu, pos.left, pos.top, menuItems,
                            readonly);
    return false;
  }

  /**
   * Dismiss the menu currently shown. If there is no menu currently shown, does
   * nothing.
   */
  dismiss(): void {
    // We may be called when there is no menu active.
    if (this.currentDropdown !== undefined) {
      this.currentDropdown.dismiss();
    }
  }

  displayContextMenu(cmClass: typeof ActionContextMenu, x: number, y: number,
                     items: Item[], readonly: boolean): void {
    // Eliminate duplicate items. We perform a check only in the description of
    // the action, and on ``data.name``.
    const seen: Record<string, boolean> = Object.create(null);
    items = items.filter((item) => {
      // "\0" not a legitimate value in descriptions.
      let actionKey = `${(item.action !== null ?
                       item.action.getDescription() : "")}\0`;
      if (item.data !== null) {
        actionKey += item.data.name;
      }
      const keep = !seen[actionKey];
      seen[actionKey] = true;

      if (!keep || !readonly) {
        return keep;
      }

      // If we get here, then we need to filter out anything that transforms the
      // tree.
      return !(item.action instanceof Transformation);
    });

    this.dismiss();
    this.caretManager.pushSelection();
    // eslint-disable-next-line new-cap
    this.currentDropdown = new cmClass(
      this.doc, x, y, items,
      () => {
        this.currentDropdown = undefined;
        this.caretManager.popSelection();
      });
  }

  private getMenuItemsForAttribute(): Action<{}>[] {
    return [];
  }

  private getMenuItemsForElement(node: HTMLElement, offset: number,
                                 wrap: boolean): Item[] {
    let actualNode: HTMLElement | null = node;
    // If we are in a phantom, we want to get to the first parent which is not
    // phantom.
    let lastPhantomChild: HTMLElement | undefined;
    while (actualNode !== null && actualNode.classList.contains("_phantom")) {
      lastPhantomChild = actualNode;
      actualNode = actualNode.parentNode as HTMLElement;
    }

    if (actualNode === null || !this.guiRoot.contains(actualNode)) {
      return [];
    }

    if (lastPhantomChild !== undefined) {
      // The actualNode exists and is in our GUI tree. If the offset is outside
      // editable contents, move it into editable contents.
      ({ offset } = this.caretManager
       .normalizeToEditableRange(DLoc.mustMakeDLoc(this.guiRoot,
                                                   lastPhantomChild)));
    }

    const menuItems: Item[] = [];
    const pushItem = (data: TransformationData | null,
                      tr: Action<TransformationData>): void =>  {
      const li = this.makeMenuItemForAction(tr, data);
      menuItems.push({ action: tr, item: li, data: data });
    };

    if (// Should not be part of a gui element.
      !(actualNode.parentNode as Element).classList.contains("_gui")) {
      // We want the data node, not the gui node.
      const treeCaret = this.caretManager.toDataLocation(actualNode, offset);
      if (treeCaret === undefined) {
        throw new Error("cannot find tree caret");
      }
      // We are cheating a bit here. treeCaret.node cannot be a text node
      // because of the way this method is invoked. It cannot be an attribute
      // either. However, it could be a Document, which happens if the edited
      // document is empty.
      const dataNode = treeCaret.node as Element;
      const tagName = dataNode.tagName;
      if (tagName != null) {
        const docURL = this.mode.documentationLinkFor(tagName);

        if (docURL != null) {
          const li = this.makeDocumentationMenuItem(docURL);
          menuItems.push({ action: null, item: li, data: null });
        }
      }

      const trs = this.editor.getElementTransformationsAt(
        treeCaret, wrap ? "wrap" : "insert");
      for (const tr of trs) {
        // If tr.name is not undefined we have a real transformation.
        // Otherwise, it is an action.
        pushItem((tr.name !== undefined) ? { name: tr.name } : null, tr.tr);
      }

      if (dataNode !== this.dataRoot.firstChild && dataNode !== this.dataRoot) {
        const actions = this.mode.getContextualActions(
          ["unwrap", "delete-parent", "split"], tagName, dataNode, 0);
        for (const action of actions) {
          pushItem({ node: dataNode, name: tagName }, action);
        }
      }
    }

    const $sep = $(actualNode).parents().addBack()
      .siblings("[data-wed--separator-for]").first();
    const sepFor = $sep[0] !== undefined ?
      $sep[0].getAttribute("data-wed--separator-for") : null;
    if (sepFor !== null) {
      const transformationNode = $sep.siblings()
        .filter(function filter(this: Element): boolean {
          // Node.contains() will return true if this === node, whereas
          // jQuery.has() only looks at descendants, so this can't be replaced
          // with .has().
          return this.contains(actualNode!);
        })[0];
      const actions = this.mode.getContextualActions(
        ["merge-with-next", "merge-with-previous", "append", "prepend"], sepFor,
        $.data(transformationNode, "wed_mirror_node"), 0);
      for (const action of actions) {
        pushItem({ node: transformationNode, name: sepFor }, action);
      }
    }

    return menuItems;
  }

  /**
   * Make a standardized menu item for a specific action. This method formats
   * the menu item and sets an even handler appropriate to invoke the action's
   * event handler.
   *
   * @param action The action for which we make a menu item.
   *
   * @param data The data that accompanies the action.
   *
   * @param start This parameter determines whether we are creating an item for
   *              a start label (``true``) an end label (``false``) or
   *              something which is neither a start or end label
   *              (``undefined``).
   *
   * @returns A HTML element which is fit to serve as a menu item.
   */
  makeMenuItemForAction<D>(action: Action<D>, data: D,
                           start?: boolean): HTMLElement {
    const icon = action.getIcon();
    const li = htmlToElements(
      `<li><a tabindex='0' href='#'>${icon !== undefined ? `${icon} ` : ""}\
</a></li>`,
      this.doc)[0] as HTMLElement;

    if (action instanceof Transformation && action.kind !== undefined) {
      li.setAttribute("data-kind", action.kind);
    }

    const a = li.firstElementChild!;
    // We do it this way so that to avoid an HTML interpretation of
    // action.getDescriptionFor()`s return value.
    const text = this.doc.createTextNode(action.getDescriptionFor(data) +
                                         atStartToTxt[String(start)]);
    a.appendChild(text);
    a.normalize();
    $(a).click(data, action.boundTerminalHandler);
    return li;
  }

  /**
   * Makes an HTML link to open the documentation of an element.
   *
   * @param docUrl The URL to the documentation to open.
   *
   * @returns A ``&lt;a>`` element that links to the documentation.
   */
  makeDocumentationMenuItem(docURL: string): HTMLElement {
    const iconHtml = makeHTML("documentation");
    const li = htmlToElements(
      `<li><a tabindex='0' href='#'>${iconHtml} \
Element's documentation.</a></li>`, this.doc)[0] as HTMLElement;
    const a = li.firstElementChild!;
    $(a).click(() => {
      this.editor.openDocumentationLink(docURL);
    });
    return li;
  }

  setupCompletionMenu(): void {
    this.dismiss();
    const sel = this.caretManager.sel;

    // We must not have an actual range in effect
    if (sel === undefined || !sel.collapsed) {
      return;
    }

    // If we have a selection, we necessarily have a caret.
    const caret = this.caretManager.getNormalizedCaret()!;
    const node = caret.node;
    const attrVal = closestByClass(node, "_attribute_value", this.guiRoot);
    if (attrVal !== null) {
      if (isNotDisplayed(attrVal as HTMLElement, this.guiRoot)) {
        return;
      }

      const doc = node.ownerDocument;
      // If we have a selection, we necessarily have a caret.
      const dataCaret = this.caretManager.getDataCaret()!;
      // The node is necessarily an attribute.
      const dataNode = dataCaret.node as Attr;
      // We complete only at the end of an attribute value.
      if (dataCaret.offset !== dataNode.value.length) {
        return;
      }

      // First see if the mode has something to say.
      const possible = this.mode.getAttributeCompletions(dataNode);

      if (possible.length === 0) {
        // Nothing from the mode, use the validator.
        this.editor.validator.possibleAt(dataCaret.node, 0)
          .forEach((ev) => {
            if (ev.params[0] !== "attributeValue") {
              return;
            }

            const text = ev.params[1];
            if (text instanceof RegExp) {
              return;
            }

            possible.push(text);
          });
      }

      // Nothing to complete.
      if (possible.length === 0) {
        return;
      }

      const narrowed = [];
      for (const possibility of possible) {
        if (possibility.lastIndexOf(dataNode.value, 0) === 0) {
          narrowed.push(possibility);
        }
      }

      // The current value in the attribute is not one that can be
      // completed.
      if (narrowed.length === 0 ||
          (narrowed.length === 1 && narrowed[0] === dataNode.value)) {
        return;
      }

      const pos = this.computeMenuPosition(undefined, true);

      this.caretManager.pushSelection();
      const menu = this.currentDropdown = new CompletionMenu(
        this.editor, doc, pos.left, pos.top, dataNode.value, possible,
        () => {
          this.currentDropdown = undefined;
          // If the focus moved from the document to the completion menu, we
          // want to restore the caret. Otherwise, leave it as is.
          if (menu.focused) {
            this.caretManager.popSelection();
          }
          else {
            this.caretManager.popSelectionAndDiscard();
          }
        });
    }
  }

  /**
   * Computes where a menu should show up, depending on the event that triggered
   * it.
   *
   * @param e The event that triggered the menu. If no event is passed, it is
   * assumed that the menu was not triggered by a mouse event.
   *
   * @param bottom If the event was not triggered by a mouse event, then use the
   * bottom of the DOM entity used to compute the position, rather than its
   * middle to determine the ``y`` coordinate of the context menu.
   *
   * @returns The top and left coordinates where the menu should appear.
   */
  computeMenuPosition(e: JQueryEventObject | undefined,
                      bottom: boolean = false): { top: number, left: number } {
    if (e === undefined) {
      e = {} as JQueryEventObject;
    }

    // Take care of cases where the user is using the mouse.
    if (e.type === "mousedown" || e.type === "mouseup" || e.type === "click" ||
        e.type === "contextmenu") {
      return { left: e.clientX, top: e.clientY };
    }

    // The next conditions happen only if the user is using the keyboard
    const mark = this.caretManager.mark;
    if (mark.inDOM) {
      mark.scrollIntoView();
      // We need to refresh immediately and acquire the client rectangle of the
      // caret.
      mark.refresh();
      const rect = mark.getBoundingClientRect();
      return {
        top: bottom ? rect.bottom : (rect.top + (rect.height / 2)),
        left: rect.left,
      };
    }

    const gui = closestByClass(this.caretManager.caret!.node, "_gui",
                               this.guiRoot);
    if (gui !== null) {
      const rect = gui.getBoundingClientRect();
      // Middle of the region.
      return {
        top: bottom ? rect.bottom : (rect.top + (rect.height / 2)),
        left: rect.left + (rect.width / 2),
      };
    }

    throw new Error("no position for displaying the menu");
  }
}
