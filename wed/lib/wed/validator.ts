/**
 * This module is responsible for validating the document being edited in wed.
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */

import {EventSet, Grammar} from "salve";
import {
  ErrorData,
  Options,
  Validator as BaseValidator,
  WorkingState
} from "salve-dom";

import * as dloc from "./dloc";
import {isElement, isNode} from "./domtypeguards";

export const INCOMPLETE = WorkingState.INCOMPLETE;
export const WORKING = WorkingState.WORKING;
export const INVALID = WorkingState.INVALID;
export const VALID = WorkingState.VALID;

export interface ModeValidator {
  validateDocument(): ErrorData[];
}

function secondsToMilliseconds(seconds: number): number {
  if(typeof seconds ==="undefined") {
    return 0;
  }

  if(seconds === 0) {
    return 0;
  }

  return seconds * 1000;
}

const salveTimeout = secondsToMilliseconds(2);
const salveTimespan = secondsToMilliseconds(1);
const salveThrottle = secondsToMilliseconds(60 * 10); // 10 Minutes

/**
 * A document validator.
 */
export class Validator extends BaseValidator {

  private canValidate: boolean;

  /**
   * @param schema A path to the schema to pass to salve for validation. This is
   * a path that will be interpreted by RequireJS. The schema must have already
   * been prepared for use by salve. See salve's documentation. Or this can be a
   * ``Grammar`` object that has already been produced from ``salve``'s
   * ``constructTree``.
   *
   * @param root The root of the DOM tree to validate. This root contains the
   * document to validate but is not **part** of it.
   *
   * @param modeValidators The mode-specific validators to use.
   * @param options
   */
  constructor(schema: Grammar,
              root: Element | Document,
              private readonly modeValidators: ModeValidator[],
              options: Options) {
    super(schema, root, options);

    this.canValidate = false;
    //
    setInterval(() => {
      this.canValidate = true;
    }, salveThrottle, this);
  }

  public static constructDefault(schema: Grammar,
                                 root: Element | Document,
                                 modeValidators: ModeValidator[]) {
    return new Validator(
      schema,
      root,
      modeValidators,
      {
        timeout: salveTimeout,
        maxTimespan: salveTimespan
      }
    );
  }

  customValidationHandler(typeOfValidation: String, functionOfValidation: Function): void {
    console.log(typeOfValidation);

    if (!(this.canValidate)) {
      console.log("Throttling validation, please wait...");
      return
    }

    console.log("Validating...");
    functionOfValidation();

    this.canValidate = false;
  }

  /**
   * Runs document-wide validation specific to the mode passed to
   * the validator.
   */
  _runDocumentValidation(): void {
    const typeOfValidation = "_runDocumentValidation";
    const functionOfValidation = () => {
      for (const validator of this.modeValidators) {
        const errors = validator.validateDocument();
        for (const error of errors) {
          this._processError(error);
        }
      }
    };

    this.customValidationHandler(typeOfValidation, functionOfValidation.bind(this))
  }

  /**
   * Runs document-wide validation specific to the mode passed to
   * the validator.
   */
  _runDocumentValidationImmediately(): void {
    this.canValidate = true;
    this._runDocumentValidation();
  }

  restartAt(node: Node): void {
    const typeOfValidation = "restartAt";
    const functionOfValidation = () => {
      super.restartAt(node);
    };

    this.customValidationHandler(typeOfValidation, functionOfValidation.bind(this))
  }

  restartAtImmediately(node: Node): void {
    this.canValidate = true;
    this.restartAt(node);
  }

  resetTo(node: Node): void {
    const typeOfValidation = "resetTo";
    const functionOfValidation = () => {
      super.resetTo(node);
    };

    this.customValidationHandler(typeOfValidation, functionOfValidation.bind(this))
  }

  resetToImmediately(node: Node): void {
    this.canValidate = true;
    this.resetTo(node);
  }

  /**
   * Returns the set of possible events for the location specified by the
   * parameters.
   *
   * @param loc Location at which to get possibilities.
   *
   * @param container Together with ``index`` this parameter is interpreted to
   * form a location as would be specified by ``loc``.
   *
   * @param index Together with ``container`` this parameter is interpreted to
   * form a location as would be specified by ``loc``.
   *
   * @param attributes Whether we are interested in the attribute events of the
   * node pointed to by ``container, index``. If ``true`` the node pointed to by
   * ``container, index`` must be an element, and the returned set will contain
   * attribute events.
   *
   * @returns A set of possible events.
   */
  possibleAt(loc: dloc.DLoc, attributes?: boolean): EventSet;
  possibleAt(container: Node, index: number,
             attributes?: boolean): EventSet;
  possibleAt(container: Node | dloc.DLoc, index: number | boolean = false,
             attributes: boolean = false): EventSet {
    if (container instanceof dloc.DLoc) {
      if (typeof index !== "boolean") {
        throw new Error("2nd parameter must be boolean");
      }
      attributes = index;
      index = container.offset;
      container = container.node;
    }

    if (typeof index !== "number") {
      throw new Error("index must be a number");
    }
    return super.possibleAt(container, index, attributes);
  }

  /**
   * Validate a DOM fragment as if it were present at the point specified in the
   * parameters in the DOM tree being validated.
   *
   * WARNING: This method will not catch unclosed elements. This is because the
   * fragment is not considered to be a "complete" document. Unclosed elements
   * or fragments that are not well-formed must be caught by other means.
   *
   * @param loc The location in the tree to start at.
   *
   * @param container The location in the tree to start at, if ``loc`` is not
   * used.
   *
   * @param index The location in the tree to start at, if ``loc`` is not used.
   *
   * @param toParse The fragment to parse.
   *
   * @returns An array of errors if there is an error. Otherwise returns false.
   */
  speculativelyValidate(loc: dloc.DLoc,
                        toParse: Node | Node[]): ErrorData[] | false;
  speculativelyValidate(container: Node, index: number,
                        toParse: Node | Node[]): ErrorData[] | false;
  speculativelyValidate(container: Node | dloc.DLoc,
                        index: number | Node | Node[],
                        toParse?: Node | Node[]): ErrorData[] | false {
    if (container instanceof dloc.DLoc) {
      if (!(isNode(index) || index instanceof Array)) {
        throw new Error("2nd argument must be a Node or an array of Nodes");
      }
      toParse = index;
      index = container.offset;
      container = container.node;
    }

    if (typeof index !== "number") {
      throw new Error("index must be a number");
    }

    if (toParse === undefined) {
      throw new Error("toParse must be defined");
    }

    return super.speculativelyValidate(container, index, toParse);
  }

  /**
   * Validate a DOM fragment as if it were present at the point specified in the
   * parameters in the DOM tree being validated.
   *
   * WARNING: This method will not catch unclosed elements. This is because the
   * fragment is not considered to be a "complete" document. Unclosed elements
   * or fragments that are not well-formed must be caught by other means.
   *
   * @param loc The location in the tree to start at.
   *
   * @param container The location in the tree to start at.
   *
   * @param index The location in the tree to start at.
   *
   * @param toParse The fragment to parse. This fragment must not be part of the
   * tree that the validator normally validates. (It can be **cloned** from that
   * tree.) This fragment must contain a single top level element which has only
   * one child. This child is the element that will actually be parsed.
   *
   * @returns An array of errors if there is an error. Otherwise returns false.
   */
  speculativelyValidateFragment(loc: dloc.DLoc,
                                toParse: Element): ErrorData[] | false;
  speculativelyValidateFragment(container: Node, index: number,
                                toParse: Element): ErrorData[] | false;
  speculativelyValidateFragment(container: Node | dloc.DLoc,
                                index: number | Element,
                                toParse?: Element): ErrorData[] | false {
    if (container instanceof dloc.DLoc) {
      if ((typeof index === "number") || !isElement(index)) {
        // It appears as "toParse" to the caller, not "index".
        throw new Error("toParse is not an element");
      }
      toParse = index;
      index = container.offset;
      container = container.node;
    }

    if (typeof index !== "number") {
      throw new Error("index must be a number");
    }

    if (toParse === undefined) {
      throw new Error("toParse must be defined");
    }

    return super.speculativelyValidateFragment(container, index, toParse);
  }
}

//  LocalWords:  boolean Dubeau Mangalam validator MPL RequireJS unclosed DOM
//  LocalWords:  speculativelyValidate nd toParse
