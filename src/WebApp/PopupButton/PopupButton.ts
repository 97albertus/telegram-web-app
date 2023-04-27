import { WebAppPopupParamInvalidError } from '../../Errors';
import { EventPopupButton, PopupButton, PopupButtonType } from '../../types';

const TYPES = {
  DEFAULT: 'default',
  OK: 'ok',
  CLOSE: 'close',
  CANCEL: 'cancel',
  DESTRUCTIVE: 'destructive',
} as const;

const VALID_BUTTON_TYPES = Object.values(TYPES);

const TYPES_WITH_REQUIRED_TEXT = [TYPES.DEFAULT, TYPES.DESTRUCTIVE] as PopupButtonType[];

export class WebAppPopupButton {
  static get TYPES() {
    return TYPES;
  }
  static get MAX_ID_LENGTH() {
    return 64;
  }
  static get MAX_TEXT_LENGTH() {
    return 64;
  }

  #button: EventPopupButton = {} as EventPopupButton;

  #setID(id: string): this {
    const stringifiedID = (id ?? '').toString();

    if (stringifiedID.length > WebAppPopupButton.MAX_ID_LENGTH) {
      throw new WebAppPopupParamInvalidError(`button id is too long ${id}`);
    }

    this.#button.id = stringifiedID;

    return this;
  }

  #setType(type: PopupButtonType): this {
    const isValidType = VALID_BUTTON_TYPES.includes(type);

    if (!isValidType) {
      throw new WebAppPopupParamInvalidError(`button type is invalid ${type}`);
    }

    this.#button.type = type;

    return this;
  }

  #setText(text: PopupButton['text']): void {
    if (!this.#button.type) {
      throw new WebAppPopupParamInvalidError(
        'You should set type for `WebAppPopupButton` before setting the text'
      );
    }

    const isTextRequired = TYPES_WITH_REQUIRED_TEXT.includes(this.#button.type);

    if (!isTextRequired) {
      return;
    }

    const normalizedText = (text ?? '').toString().trim();

    if (!normalizedText) {
      throw new WebAppPopupParamInvalidError(
        `button text is required for type ${this.#button.type} ${text}`
      );
    }

    if (normalizedText.length > WebAppPopupButton.MAX_TEXT_LENGTH) {
      throw new WebAppPopupParamInvalidError(`button text is too long ${normalizedText}`);
    }

    this.#button.text = normalizedText;
  }

  constructor(config: EventPopupButton | WebAppPopupButton) {
    const { id, type, text } = config instanceof WebAppPopupButton ? config.data : config;

    this.#setID(id).#setType(type).#setText(text);
  }

  get data(): EventPopupButton {
    return this.#button;
  }
}
