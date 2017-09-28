/**
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */
import { expect } from "chai";
import * as mergeOptions from "merge-options";
import * as sinon from "sinon";

import * as browsers from "wed/browsers";
import { CaretManager } from "wed/caret-manager";
import { isAttr } from "wed/domtypeguards";
import * as keyConstants from "wed/key-constants";
import * as log from "wed/log";
import * as onerror from "wed/onerror";
import { TaskRunner } from "wed/task-runner";
import { ValidationController } from "wed/validation-controller";
import * as wed from "wed/wed";

import * as globalConfig from "../base-config";
import { DataProvider, makeFakePasteEvent, makeWedRoot, setupServer,
         waitForSuccess } from "../util";
import { firstGUI } from "../wed-test-util";

const options = {
  schema: "/base/build/schemas/tei-simplified-rng.js",
  mode: {
    path: "wed/modes/test/test-mode",
    options: {
      metadata: "/base/build/schemas/tei-metadata.json",
    },
  },
};

const assert = chai.assert;
const _slice = Array.prototype.slice;

describe("wed validation errors:", () => {
  let source: string;
  let editor: wed.Editor;
  let caretManager: CaretManager;
  let topSandbox: sinon.SinonSandbox;
  let wedroot: HTMLElement;
  let controller: ValidationController;
  let processRunner: TaskRunner;
  let refreshRunner: TaskRunner;
  let guiRoot: Element;

  before(async () => {
    const provider =
      new DataProvider("/base/build/standalone/lib/tests/wed_test_data/");
    source = await provider.getText("source_converted.xml");
  });

  before(() => {
    topSandbox = sinon.sandbox.create({
      useFakeServer: true,
    });
    setupServer(topSandbox.server);

    wedroot = makeWedRoot(document);
    document.body.appendChild(wedroot);
    editor = new wed.Editor(wedroot,
                            mergeOptions(globalConfig.config, options));
    return editor.init(source)
      .then(() => {
        // tslint:disable-next-line:no-any
        (editor.validator as any)._validateUpTo(editor.dataRoot, -1);
        processRunner =
          // tslint:disable-next-line:no-any
          (editor.validationController as any).processErrorsRunner;
        refreshRunner =
          // tslint:disable-next-line:no-any
          (editor.validationController as any).refreshErrorsRunner;
        caretManager = editor.caretManager;
        controller = editor.validationController;
        guiRoot = editor.guiRoot;
      });
  });

  beforeEach(() => {
    // Force the processing of errors
    controller.processErrors();
    editor.undoAll();
    editor.resetLabelVisibilityLevel();
  });

  afterEach(() => {
    assert.isFalse(onerror.is_terminating(),
                   "test caused an unhandled exception to occur");
    // We don't reload our page so we need to do this.
    onerror.__test.reset();
    editor.editingMenuManager.dismiss();
  });

  after(() => {
    if (editor !== undefined) {
      editor.destroy();
    }

    // We read the state, reset, and do the assertion later so that if the
    // assertion fails, we still have our reset.
    const wasTerminating = onerror.is_terminating();

    // We don't reload our page so we need to do this.
    onerror.__test.reset();
    log.clearAppenders();
    expect(wasTerminating)
      .to.equal(false, "test caused an unhandled exception to occur");

    // tslint:disable-next-line:no-any
    (editor as any) = undefined;
    // tslint:disable-next-line:no-any
    (caretManager as any) = undefined;
    // tslint:disable-next-line:no-any
    (controller as any) = undefined;

    if (topSandbox !== undefined) {
      topSandbox.restore();
    }
    document.body.removeChild(wedroot);
  });

  it("validation errors added by the mode", () => {
    const errors = controller.copyErrorList();
    const last = errors[errors.length - 1];
    assert.equal(last.ev.error.toString(), "Test");
  });

  it("refreshErrors does not change the number of errors", async () => {
    await processRunner.onCompleted();
    const count = controller.copyErrorList().length;
    const listCount = editor.$errorList.children("li").length;
    const markerCount = guiRoot.getElementsByClassName("wed-validation-error")
      .length;

    controller.refreshErrors();
    await refreshRunner.onCompleted();

    assert.equal(count, controller.copyErrorList().length,
                 "the number of recorded errors should be the same");
    assert.equal(listCount, editor.$errorList.children("li").length,
                 "the number of errors in the panel should be the same");
    assert.equal(markerCount,
                 guiRoot.getElementsByClassName("wed-validation-error").length,
                 "the number of markers should be the same");
  });

  // tslint:disable-next-line:mocha-no-side-effect-code
  const itNoIE = browsers.MSIE ? it.skip : it;

  // This cannot be run on IE due to the way IE screws up the
  // formatting of contenteditable elements.
  // tslint:disable-next-line:mocha-no-side-effect-code
  itNoIE("errors for inline elements in a correct position", async () => {
    await processRunner.onCompleted();
    const p = guiRoot.querySelectorAll(".body .p")[12];
    const dataP = editor.toDataNode(p)!;
    const dataMonogr = dataP.childNodes[0] as Element;
    const monogr = $.data(dataMonogr, "wed_mirror_node");
    assert.equal(dataMonogr.tagName, "monogr");

    let pError;
    let pErrorIx: number = 0;
    let monogrError;
    let monogrErrorIx: number = 0;
    let i = 0;
    for (const error of controller.copyErrorList()) {
      if (pError === undefined && error.ev.node === dataP) {
        pError = error;
        pErrorIx = i;
      }

      if (monogrError === undefined && error.ev.node === dataMonogr) {
        monogrError = error;
        monogrErrorIx = i;
      }
      i++;
    }

    // Make sure we found our errors.
    assert.isDefined(pError, "no error for our paragraph");
    assert.isDefined(monogrError, "no error for our monogr");

    // Find the corresponding markers
    // tslint:disable-next-line:no-any
    const markers = (editor as any).errorLayer.el.children;
    const pMarker = markers[pErrorIx];
    const monogrMarker = markers[monogrErrorIx];
    assert.isDefined(pMarker, "should have an error for our paragraph");
    assert.isDefined(monogrMarker, "should have an error for our monogr");

    const pMarkerRect = pMarker.getBoundingClientRect();

    // The pMarker should appear to the right of the start label for the
    // paragraph and overlap with the start label for monogr.
    const pStartLabel = firstGUI(p)!;
    assert.isTrue(pStartLabel.classList.contains("__start_label"),
                  "should should have a start label for the paragraph");
    const pStartLabelRect = pStartLabel.getBoundingClientRect();
    assert.isTrue(pMarkerRect.left >= pStartLabelRect.right,
                  "the paragraph error marker should be to the right of the \
start label for the paragraph");
    assert.isTrue(Math.abs(pMarkerRect.bottom - pStartLabelRect.bottom) <= 5,
                  "the paragraph error marker should have a bottom which is \
within 5 pixels of the bottom of the start label for the paragraph");
    assert.isTrue(Math.abs(pMarkerRect.top - pStartLabelRect.top) <= 5,
                  "the paragraph error marker should have a top which is \
within 5 pixels of the top of the start label for the paragraph");

    const monogrStartLabel = firstGUI(monogr)!;
    assert.isTrue(monogrStartLabel.classList.contains("__start_label"),
                  "should should have a start label for the paragraph");
    const monogrStartLabelRect = monogrStartLabel.getBoundingClientRect();
    assert.isTrue(Math.abs(pMarkerRect.left - monogrStartLabelRect.left) <= 5,
                  "the paragraph error marker have a left side within 5 pixels \
of the left side of the start label for the monogr");

    // The monogrMarker should be to the right of the monogrStartLabel.
    const monogrMarkerRect = monogrMarker.getBoundingClientRect();

    assert.isTrue(monogrMarkerRect.left >= monogrStartLabelRect.right,
                  "the monogr error marker should be to the right of the \
start label for the monogr");
    monogrMarker.scrollIntoView();
    assert.isTrue(Math.abs(monogrMarkerRect.bottom -
                           monogrStartLabelRect.bottom) <= 5,
                  "the monogr error marker should have a bottom which is \
within 5 pixels of the bottom of the start label for the monogr");
    assert.isTrue(Math.abs(monogrMarkerRect.top -
                           monogrStartLabelRect.top) <= 5,
                  "the monogr error marker should have a top which is within \
5 pixels of the top of the start label for the monogr");
  });

  it("the attributes error are not linked", async () => {
    editor.setLabelVisibilityLevel(0);

    await processRunner.onCompleted();
    let cases = 0;
    for (const { ev, item } of controller.copyErrorList()) {
      if (!isAttr(ev.node)) {
        continue;
      }
      assert.isTrue(item!.getElementsByTagName("a").length === 0,
                    "there should be no link in the item");
      assert.equal(
        item!.title,
        "This error belongs to an attribute which is not currently displayed.",
        "the item should have the right title");
      cases++;
    }
    assert.equal(cases, 2);
  });

  function assertNewMarkers(orig: Element[], after: Element[],
                            event: string): void {
    // Make sure all markers are new.
    const note = ` after ${event}`;
    for (const item of orig) {
      assert.notInclude(after, item,
                        `the list of markers should be new${note}`);
    }

    // We do not compare the number of errors, because changing the label
    // visibility may change the number of errors shown to the user.
  }

  it("recreates errors when changing label visibility level", async () => {
    // Changing label visibility does not merely refresh the errors but
    // recreates them because errors that were visible may become invisible or
    // errors that were invisible may become visible.

    await processRunner.onCompleted();
    // tslint:disable-next-line:no-any
    const errorLayer = (editor as any).errorLayer.el as Element;
    let orig = _slice.call(errorLayer.children);

    // Reduce the visibility level.
    editor.type(keyConstants.CTRLEQ_OPEN_BRACKET);
    let after;
    await waitForSuccess(() => {
      after = _slice.call(errorLayer.children);
      assertNewMarkers(orig, after, "decreasing the level");
    });

    orig = after;

    // Increase visibility level
    editor.type(keyConstants.CTRLEQ_CLOSE_BRACKET);
    await waitForSuccess(() => {
      assertNewMarkers(orig, _slice.call(errorLayer.children),
                       "increasing the level");
    });
  });

  it("refreshes error positions when pasting", async () => {
    await refreshRunner.onCompleted();

    // Paste.
    const initial = editor.dataRoot.querySelector("body>p")!.firstChild!;
    caretManager.setCaret(initial, 0);
    const initialValue = initial.textContent;

    // Synthetic event
    const event = makeFakePasteEvent({
      types: ["text/plain"],
      getData: () => "abcdef",
    });
    editor.$guiRoot.trigger(event);
    assert.equal(initial.nodeValue, `abcdef${initialValue}`);

    // refreshRunner returns to an incomplete states, which means there will be
    // a refresh.
    assert.isFalse(refreshRunner.completed);
  });

  it("refreshes error positions when typing text", async () => {
    await refreshRunner.onCompleted();

    // Text node inside title.
    const initial = guiRoot.getElementsByClassName("title")[0].childNodes[1];
    const parent = initial.parentNode!;
    caretManager.setCaret(initial, 0);

    editor.type("blah");
    assert.equal(initial.nodeValue, "blahabcd");
    assert.equal(parent.childNodes.length, 3);

    // refreshRunner returns to an incomplete states, which means there will be
    // a refresh.
    assert.isFalse(refreshRunner.completed);
  });

  it("refreshes error positions when typing DELETE", async () => {
    await refreshRunner.onCompleted();

    // Text node inside title.
    const initial = guiRoot.getElementsByClassName("title")[0].childNodes[1];
    const parent = initial.parentNode!;
    caretManager.setCaret(initial, 0);

    editor.type(keyConstants.DELETE);
    assert.equal(initial.nodeValue, "bcd");
    assert.equal(parent.childNodes.length, 3);

    // refreshRunner returns to an incomplete states, which means there will be
    // a refresh.
    assert.isFalse(refreshRunner.completed);
  });

  it("refreshes error positions when typing BACKSPACE", async () => {
    await refreshRunner.onCompleted();

    // Text node inside title.
    const initial = guiRoot.getElementsByClassName("title")[0].childNodes[1];
    const parent = initial.parentNode!;
    caretManager.setCaret(initial, 4);

    editor.type(keyConstants.BACKSPACE);
    assert.equal(initial.nodeValue, "abc");
    assert.equal(parent.childNodes.length, 3);

    // refreshRunner returns to an incomplete states, which means there will be
    // a refresh.
    assert.isFalse(refreshRunner.completed);
  });
});
