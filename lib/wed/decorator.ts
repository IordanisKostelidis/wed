/**
 * Basic decoration facilities.
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */

import * as  $ from "jquery";
import * as salve from "salve";

import { Action } from "./action";
import { DLoc } from "./dloc";
import { Listener } from "./domlistener";
import { isAttr, isElement } from "./domtypeguards";
import * as  domutil from "./domutil";
import { GUIUpdater } from "./gui-updater";
import { ActionContextMenu, Item } from "./gui/action-context-menu";
import { TransformationData } from "./transformation";
import { BeforeInsertNodeAtEvent, InsertNodeAtEvent } from "./tree-updater";
import * as  util from "./util";
import { Editor } from "./wed";

const indexOf = domutil.indexOf;
const closestByClass = domutil.closestByClass;

function tryToSetDataCaret(editor: Editor, dataCaret: DLoc): void {
  try {
    editor.caretManager.setCaret(dataCaret, { textEdit: true });
  }
  catch (e) {
    // Do nothing.
  }
}

function attributeSelectorMatch(selector: string, name: string): boolean {
  return selector === "*" || selector === name;
}

/**
 * A decorator is responsible for adding decorations to a tree of DOM
 * elements. Decorations are GUI elements.
 */
export class Decorator {
  /**
   * @param domlistener The listener that the decorator must use to know when
   * the DOM tree has changed and must be redecorated.
   *
   * @param editor The editor instance for which this decorator was created.
   *
   * @param guiUpdater The updater to use to modify the GUI tree. All
   * modifications to the GUI must go through this updater.
   *
   * @param namespaces A copy of the absolute namespace mappings in effect.
   */
  constructor(protected readonly domlistener: Listener,
              protected readonly editor: Editor,
              protected readonly guiUpdater: GUIUpdater,
              protected readonly namespaces: Record<string, string>) {}

  /**
   * Request that the decorator add its event handlers to its listener.
   */
  addHandlers(): void {
    this.guiUpdater.events.subscribe((ev) => {
      switch (ev.name) {
      case "BeforeInsertNodeAt":
        if (isElement(ev.node)) {
          this.initialContentEditableHandler(ev);
        }
        break;
      case "InsertNodeAt":
        if (isElement(ev.node)) {
          this.finalContentEditableHandler(ev);
        }
        break;
      default:
      }
    });
  }

  /**
   * Start listening to changes to the DOM tree.
   */
  startListening(): void {
    this.domlistener.startListening();
  }

  /**
   * This function adds a separator between each child element of the element
   * passed as ``el``. The function only considers ``._real`` elements.
   *
   * @param el The element to decorate.
   *
   * @param sep A separator.
   */
  listDecorator(el: Element, sep: string | Element): void {
    // We expect to work with a homogeneous list. That is, all children the same
    // element.
    const nameMap: Record<string, number> = Object.create(null);
    let child = el.firstElementChild;
    while (child !== null) {
      if (child.classList.contains("_real")) {
        nameMap[util.getOriginalName(child)] = 1;
      }
      child = child.nextElementSibling;
    }

    const tags = Object.keys(nameMap);
    if (tags.length > 1) {
      throw new Error("calling listDecorator on a non-homogeneous list.");
    }

    if (tags.length === 0) {
      return;
    } // Nothing to work with

    // First drop all children that are separators
    child = el.firstElementChild;
    while (child !== null) {
      // Grab it before the node is removed.
      const next = child.nextElementSibling;
      if (child.hasAttribute("data-wed--separator-for")) {
        this.guiUpdater.removeNode(child);
      }
      child = next;
    }

    const tagName = tags[0];

    // If sep is a string, create an appropriate div.
    let sepNode: Element;
    if (typeof sep === "string") {
      sepNode = el.ownerDocument.createElement("div");
      sepNode.textContent = sep;
    }
    else {
      sepNode = sep;
    }

    sepNode.classList.add("_text");
    sepNode.classList.add("_phantom");
    sepNode.setAttribute("data-wed--separator-for", tagName);

    let first = true;
    child = el.firstElementChild;
    while (child !== null) {
      if (child.classList.contains("_real")) {
        if (!first) {
          this.guiUpdater.insertBefore(el, sepNode.cloneNode(true) as Element,
                                       child);
        }
        else {
          first = false;
        }
      }
      child = child.nextElementSibling;
    }
  }

  /**
   * Handler for setting ``contenteditable`` on nodes included into the
   * tree. This handler preforms an initial generic setup that does not need
   * mode-specific information. It sets ``contenteditable`` to true on any real
   * element or any attribute value.
   */
  initialContentEditableHandler(ev: BeforeInsertNodeAtEvent): void {
    const mod = (el: Element) => {
      // All elements that may get a selection must be focusable to
      // work around issue:
      // https://bugzilla.mozilla.org/show_bug.cgi?id=921444
      el.setAttribute("tabindex", "-1");
      el.setAttribute("contenteditable",
                      String(el.classList.contains("_real") ||
                              el.classList.contains("_attribute_value")));
      let child = el.firstElementChild;
      while (child !== null) {
        mod(child);
        child = child.nextElementSibling;
      }
    };

    // We never call this function with something else than an Element for
    // ev.node.
    mod(ev.node as Element);
  }

  /**
   * Handler for setting ``contenteditable`` on nodes included into the
   * tree. This handler adjusts whether attribute values are editable by using
   * mode-specific data.
   */
  finalContentEditableHandler(ev: InsertNodeAtEvent): void {
    // We never call this function with something else than an Element for
    // ev.node.
    const el = ev.node as Element;

    const attrs = el.getElementsByClassName("_attribute_value");
    for (const attr of Array.from(attrs)) {
      if (this.editor.modeTree.getAttributeHandling(attr) !== "edit") {
        attr.setAttribute("contenteditable", "false");
      }
    }
  }

  /**
   * Add a start label at the start of an element and an end label at the end.
   *
   * @param root The root of the decorated tree.
   *
   * @param el The element to decorate.
   *
   * @param level The level of the labels for this element.
   *
   * @param preContextHandler An event handler to run when the user invokes a
   * context menu on the start label.
   *
   * @param postContextHandler An event handler to run when the user invokes a
   * context menu on the end label.
   */
  elementDecorator(root: Element, el: Element, level: number,
                   preContextHandler: ((wedEv: JQueryMouseEventObject,
                                        ev: Event) => boolean) | undefined,
                   postContextHandler: ((wedEv: JQueryMouseEventObject,
                                         ev: Event) => boolean) | undefined):
  void {
    if (level > this.editor.max_label_level) {
      throw new Error(
        `level higher than the maximum set by the mode: ${level}`);
    }

    // Save the caret because the decoration may mess up the GUI caret.
    let dataCaret: DLoc | undefined = this.editor.caretManager.getDataCaret();
    if (dataCaret != null &&
        !(isAttr(dataCaret.node) &&
          dataCaret.node.ownerElement === $.data(el, "wed_mirror_node"))) {
      dataCaret = undefined;
    }

    const dataNode = $.data(el, "wed_mirror_node");
    this.setReadOnly(el, Boolean(this.editor.validator.getNodeProperty(
      dataNode, "PossibleDueToWildcard")));

    const origName = util.getOriginalName(el);
    // _[name]_label is used locally to make the function idempotent.
    let cls = `_${origName}_label`;

    // We must grab a list of nodes to remove before we start removing them
    // because an element that has a placeholder in it is going to lose the
    // placeholder while we are modifying it. This could throw off the scan.
    const toRemove = domutil.childrenByClass(el, cls);
    for (const remove of toRemove) {
      el.removeChild(remove);
    }

    const attributesHTML = [];
    let hiddenAttributes = false;
    const attributeHandling = this.editor.modeTree.getAttributeHandling(el);
    if (attributeHandling === "show" || attributeHandling === "edit") {
      // include the attributes
      const attributes = util.getOriginalAttributes(el);
      const names = Object.keys(attributes).sort();

      for (const name of names) {
        const hideAttribute = this.mustHideAttribute(el, name);
        if (hideAttribute) {
          hiddenAttributes = true;
        }

        const extra = hideAttribute ? " _shown_when_caret_in_label" : "";

        attributesHTML.push([
          `<span class=\"_phantom _attribute${extra}\">`,
          "<span class=\"_phantom _attribute_name\">", name,
          "</span>=\"<span class=\"_phantom _attribute_value\">",
          domutil.textToHTML(attributes[name]),
          "</span>\"</span>",
        ].join(""));
      }
    }
    const attributesStr = (attributesHTML.length !== 0 ? " " : "") +
      attributesHTML.join(" ");

    const doc = el.ownerDocument;
    cls += ` _label_level_${level}`;

    // Save the cls of the end label here so that we don't further modify it.
    const endCls = cls;

    if (hiddenAttributes) {
      cls += " _autohidden_attributes";
    }
    const pre = doc.createElement("span");
    pre.className = `_gui _phantom __start_label _start_wrapper ${cls} _label`;
    const prePh = doc.createElement("span");
    prePh.className = "_phantom";
    // tslint:disable-next-line:no-inner-html
    prePh.innerHTML = `&nbsp;<span class='_phantom _element_name'>${origName}\
</span>${attributesStr}<span class='_phantom _greater_than'> >&nbsp;</span>`;
    pre.appendChild(prePh);
    this.guiUpdater.insertNodeAt(el, 0, pre);

    const post = doc.createElement("span");
    post.className = `_gui _phantom __end_label _end_wrapper ${endCls} _label`;
    const postPh = doc.createElement("span");
    postPh.className = "_phantom";
    // tslint:disable-next-line:no-inner-html
    postPh.innerHTML = `<span class='_phantom _less_than'>&nbsp;&lt; </span>\
<span class='_phantom _element_name'>${origName}</span>&nbsp;`;
    post.appendChild(postPh);
    this.guiUpdater.insertBefore(el, post, null);

    // Setup a handler so that clicking one label highlights it and
    // the other label.
    $(pre).on("wed-context-menu",
              preContextHandler !== undefined ? preContextHandler : false);

    $(post).on("wed-context-menu",
               postContextHandler !== undefined ? postContextHandler : false);

    if (dataCaret != null) {
      tryToSetDataCaret(this.editor, dataCaret);
    }
  }

  /**
   * Determine whether an attribute must be hidden. The default implementation
   * calls upon the ``attributes.autohide`` section of the "wed options" that
   * were used by the mode in effect to determine whether an attribute should be
   * hidden or not.
   *
   * @param el The element in the GUI tree that we want to test.
   *
   * @param name The attribute name in "prefix:localName" format where "prefix"
   * is to be understood according to the absolute mapping defined by the mode.
   *
   * @returns ``true`` if the attribute must be hidden. ``false`` otherwise.
   */
  mustHideAttribute(el: Element, name: string): boolean {
    const specs = this.editor.modeTree.getAttributeHidingSpecs(el);
    if (specs === null) {
      return false;
    }

    for (const element of specs.elements) {
      if (el.matches(element.selector)) {
        let matches = false;
        for (const attribute of element.attributes) {
          if (typeof attribute === "string") {
            // If we already matched, there's no need to try to match with
            // another selector.
            if (!matches) {
              matches = attributeSelectorMatch(attribute, name);
            }
          }
          else {
            // If we do not match yet, there's no need to try to exclude the
            // attribute.
            if (matches) {
              for (const exception of attribute.except) {
                matches = !attributeSelectorMatch(exception, name);
                // As soon as we stop matching, there's no need to continue
                // checking other exceptions.
                if (!matches) {
                  break;
                }
              }
            }
          }
        }

        // An element selector that matches is terminal.
        return matches;
      }
    }

    return false;
  }

  /**
   * Add or remove the CSS class ``_readonly`` on the basis of the 2nd argument.
   *
   * @param el The element to modify. Must be in the GUI tree.
   *
   * @param readonly Whether the element is readonly or not.
   */
  setReadOnly(el: Element, readonly: boolean): void {
    const cl = el.classList;
    (readonly ? cl.add : cl.remove).call(cl, "_readonly");
  }

  /**
   * Context menu handler for the labels of elements decorated by
   * [[Decorator.elementDecorator]].
   *
   * @param atStart Whether or not this event is for the start label.
   *
   * @param wedEv The DOM event that wed generated to trigger this handler.
   *
   * @param ev The DOM event that wed received.
   *
   * @returns To be interpreted the same way as for all DOM event handlers.
   */
  // tslint:disable-next-line:max-func-body-length
  protected contextMenuHandler(atStart: boolean, wedEv: JQueryMouseEventObject,
                               ev: JQueryEventObject): boolean {
    const editor = this.editor;
    let node = wedEv.target as Element;
    const menuItems: Item[] = [];
    const mode = editor.modeTree.getMode(node);

    function pushItem(data: TransformationData | null,
                      tr: Action<TransformationData>,
                      start?: boolean): void {
      const li = editor.editingMenuManager.makeMenuItemForAction(tr, data,
                                                                 start);
      menuItems.push({ action: tr, item: li, data: data });
    }

    function pushItems(data: TransformationData | null,
                       trs?: Action<{}>[], start?: boolean): void {
      if (trs === undefined) {
        return;
      }

      for (const tr of trs) {
        pushItem(data, tr, start);
      }
    }

    function processAttributeNameEvent(event: salve.Event,
                                       element: Element): void {
      const namePattern = event.params[1] as salve.Name;
      // The next if line causes tslint to inexplicably raise a failure. I am
      // able to reproduce it with something as small as:
      //
      // import { Name } from "salve";
      //
      // export function func(p: Name): void {
      //   if (p.simple()) {
      //     document.body.textContent = "1";
      //   }
      // }
      //
      // tslint:disable-next-line:strict-boolean-expressions
      if (namePattern.simple()) {
        for (const name of namePattern.toArray()) {
          const unresolved =
            mode.getAbsoluteResolver().unresolveName(name.ns, name.name);
          if (unresolved === undefined) {
            throw new Error("cannot unresolve attribute");
          }

          if (editor.isAttrProtected(unresolved, element)) {
            return;
          }

          pushItems({ name: unresolved, node: element },
                    mode.getContextualActions("add-attribute", unresolved,
                                              element));
        }
      }
      else {
        pushItem(null, editor.complex_pattern_action);
      }
    }

    const real = closestByClass(node, "_real", editor.gui_root);
    const readonly = real !== null && real.classList.contains("_readonly");

    const attrVal = closestByClass(node, "_attribute_value", editor.gui_root);
    if (attrVal !== null) {
      const dataNode = editor.toDataNode(attrVal) as Attr;
      const treeCaret =
        DLoc.mustMakeDLoc(editor.data_root, dataNode.ownerElement);
      const toAddTo = treeCaret.node.childNodes[treeCaret.offset];
      editor.validator.possibleAt(treeCaret, true).forEach((event) => {
        if (event.params[0] !== "attributeName") {
          return;
        }
        processAttributeNameEvent(event, toAddTo as Element);
      });

      const name = dataNode.name;
      if (!editor.isAttrProtected(dataNode)) {
        pushItems({ name: name, node: dataNode },
                  mode.getContextualActions("delete-attribute", name,
                                            dataNode));
      }
    }
    else {
      // We want the first real parent.
      const candidate = closestByClass(node, "_real", editor.gui_root);
      if (candidate === null) {
        throw new Error("cannot find real parent");
      }

      node = candidate;

      const topNode = (node.parentNode === editor.gui_root);

      // We first gather the transformations that pertain to the node to which
      // the label belongs.
      const orig = util.getOriginalName(node);

      const docURL = mode.documentationLinkFor(orig);
      if (docURL != null) {
        const li =
          this.editor.editingMenuManager.makeDocumentationMenuItem(docURL);
        menuItems.push({ action: null, item: li, data: null });
      }

      if (!topNode) {
        pushItems({ node: node, name: orig },
                  mode.getContextualActions(
                    ["unwrap", "delete-element"],
                    orig, $.data(node, "wed_mirror_node"), 0));
      }

      // Then we check what could be done before the node (if the
      // user clicked on an start element label) or after the node
      // (if the user clicked on an end element label).
      const parent = node.parentNode!;
      let index = indexOf(parent.childNodes, node);

      // If we're on the end label, we want the events *after* the node.
      if (!atStart) {
        index++;
      }
      const treeCaret = editor.caretManager.toDataLocation(parent, index);
      if (treeCaret === undefined) {
        throw new Error("cannot get caret");
      }

      if (atStart) {
        const toAddTo = treeCaret.node.childNodes[treeCaret.offset];
        const attributeHandling = editor.modeTree.getAttributeHandling(toAddTo);
        if (attributeHandling === "edit") {
          editor.validator.possibleAt(treeCaret, true).forEach((event) => {
            if (event.params[0] !== "attributeName") {
              return;
            }
            processAttributeNameEvent(event, toAddTo as Element);
          });
        }
      }

      if (!topNode) {
        for (const tr of editor.getElementTransformationsAt(treeCaret,
                                                            "insert")) {
          if (tr.name !== undefined) {
            // Regular case: we have a real transformation.
            pushItem({ name: tr.name, moveCaretTo: treeCaret }, tr.tr, atStart);
          }
          else {
            // It is an action rather than a transformation.
            pushItem(null, tr.tr);
          }
        }

        if (atStart) {
          // Move to inside the element and get the get the wrap-content
          // possibilities.
          const caretInside =
            treeCaret.make(treeCaret.node.childNodes[treeCaret.offset], 0);
          for (const tr of editor.getElementTransformationsAt(caretInside,
                                                              "wrap-content")) {
            pushItem(tr.name !== undefined ? { name: tr.name, node: node }
                     : null,
                     tr.tr);
          }
        }
      }
    }

    // There's no menu to display, so let the event bubble up.
    if (menuItems.length === 0) {
      return true;
    }

    const pos = editor.editingMenuManager.computeMenuPosition(ev);
    editor.editingMenuManager
      .displayContextMenu(ActionContextMenu, pos.left, pos.top, menuItems,
                          readonly);
    return false;
  }
}

//  LocalWords:  sep el focusable lt enterStartTag unclick nbsp li
//  LocalWords:  tabindex listDecorator contenteditable href jQuery
//  LocalWords:  gui domlistener domutil util validator jquery
//  LocalWords:  Mangalam MPL Dubeau
