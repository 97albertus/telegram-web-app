import {
  AnyCallback,
  BackButton,
  ChatTypesToChoose,
  ClipboardTextReceivedCallbackData,
  HapticFeedback,
  HexColor,
  InitParams,
  InvoiceClosedCallbackData,
  InvoiceStatus,
  MainButton,
  NoParamsCallback,
  Nullable,
  OpenInvoiceCallback,
  OpenLinkOptions,
  OpenPopupEventData,
  PopupClosedCallbackData,
  PopupParams,
  QrTextReceivedCallbackData,
  ScanQrPopupParams,
  ShowConfirmCallback,
  ShowPopupCallback,
  ShowScanQrPopupCallback,
  ThemeParams,
  ViewportChangedCallbackData,
  WebApp,
  WebAppInitData,
  WebView,
} from '../types';
import {
  byteLength,
  generateId,
  isHTTPTypeProtocol,
  isTelegramHostname,
  parseColorToHex,
  SessionStorage,
} from '../utils';
import {
  WebAppMethodUnsupportedError,
  WebAppPopupOpenedError,
  WebAppPopupParamInvalidError,
  WebAppTelegramUrlInvalidError,
} from '../Errors';

import {
  ColorScheme,
  ColorSchemes,
  HeaderBgColor,
  WebViewEvent,
  WebViewEventParams,
} from './types';
import { COLOR_SCHEMES, HEADER_COLOR_KEYS } from './constants';
import { BACK_BUTTON_ON_EVENT_KEY, WebAppBackButton } from './BackButton';
import { BackgroundColor } from './BackgroundColor';
import { WebAppHapticFeedback } from './HapticFeedback';
import { InitData } from './InitData';
import { WebAppMainButton } from './MainButton';
import { Theme } from './Theme';
import { Viewport, ViewportData } from './Viewport';
import { Version } from './Version';
import { Invoices } from './Invoices';
import { Popup } from './Popup';
import { WebAppPopupButton } from './PopupButton';
import { ClipboardCallback, WebAppClipboard } from './Clipboard';
import { QrPopup } from './QrPopup';

const CHAT_TYPES = {
  USERS: 'users',
  BOTS: 'bots',
  GROUPS: 'groups',
  CHANNELS: 'channels',
} as const;

const VALID_CHAT_TYPES = Object.values(CHAT_TYPES);

export type ChatTypes = typeof CHAT_TYPES;

interface Dependencies {
  initData: InitData;
  version: Version;
  webView: WebView;
  bgColor: BackgroundColor;
  viewport: Viewport;
  theme: Theme;
  backButton: WebAppBackButton;
  mainButton: WebAppMainButton;
  invoices: Invoices;
  popup: Popup;
  clipboard: WebAppClipboard;
  qrPopup: QrPopup;
  hapticFeedback: WebAppHapticFeedback;
}

export class TelegramWebApp implements WebApp {
  readonly #platform: string = 'unknown';
  #headerColorKey: HeaderBgColor = HEADER_COLOR_KEYS.BG_COLOR;
  #lastWindowHeight = window.innerHeight;
  #isClosingConfirmationEnabled = false;
  readonly #initData: InitData;
  readonly #version: Version;
  readonly #theme: Theme;
  readonly #hapticFeedback: WebAppHapticFeedback;
  readonly #webView: WebView;
  readonly #bgColor: BackgroundColor;
  readonly #viewport: Viewport;
  readonly #backButton: WebAppBackButton;
  readonly #mainButton: WebAppMainButton;
  readonly #invoices: Invoices;
  readonly #popup: Popup;
  readonly #clipboard: WebAppClipboard;
  readonly #qrPopup: QrPopup;

  static readonly COLOR_SCHEMES: ColorSchemes = COLOR_SCHEMES;
  static readonly MAXIMUM_BYTES_TO_SEND = 4096;
  static get MAX_INLINE_QUERY_LENGTH(): number {
    return 256;
  }
  static get CHAT_TYPES(): ChatTypes {
    return CHAT_TYPES;
  }

  #initMainButton(): void {
    const onMainButtonClick = (isActive: boolean): void => {
      if (isActive) {
        this.#receiveWebViewEvent('mainButtonClicked');
      }
    };

    this.#webView.onEvent('main_button_pressed', () => {
      onMainButtonClick(this.#mainButton.isActive);
    });

    this.#mainButton.on(WebAppMainButton.EVENTS.DEBUG_BUTTON_CLICKED, onMainButtonClick);

    this.#mainButton.on(WebAppMainButton.EVENTS.DEBUG_BUTTON_UPDATED, this.#viewport.setHeight);

    this.#mainButton.on(WebAppMainButton.EVENTS.UPDATED, (params) => {
      this.#webView.postEvent('web_app_setup_main_button', undefined, params);
    });

    this.#mainButton.on(WebAppMainButton.EVENTS.CLICKED, (callback) => {
      this.#onWebViewEvent('mainButtonClicked', callback);
    });

    this.#mainButton.on(WebAppMainButton.EVENTS.OFF_CLICKED, (callback) => {
      this.#offWebViewEvent('mainButtonClicked', callback);
    });
  }

  #initBackButton(): void {
    this.#backButton[BACK_BUTTON_ON_EVENT_KEY](WebAppBackButton.EVENTS.CREATED, () => {
      this.#webView.onEvent('back_button_pressed', () => {
        this.#receiveWebViewEvent('backButtonClicked');
      });
    });

    this.#backButton[BACK_BUTTON_ON_EVENT_KEY](WebAppBackButton.EVENTS.UPDATED, (params) => {
      this.#webView.postEvent('web_app_setup_back_button', undefined, params);
    });

    this.#backButton[BACK_BUTTON_ON_EVENT_KEY](WebAppBackButton.EVENTS.CLICKED, (callback) => {
      this.#onWebViewEvent('backButtonClicked', callback);
    });

    this.#backButton[BACK_BUTTON_ON_EVENT_KEY](WebAppBackButton.EVENTS.OFF_CLICKED, (callback) => {
      this.#offWebViewEvent('backButtonClicked', callback);
    });
  }

  #initTheme(rawTheme: InitParams['tgWebAppThemeParams']): void {
    this.#theme.on(Theme.EVENTS.COLOR_SCHEME_CHANGED, (colorScheme) =>
      this.#setCssVar('color-scheme', colorScheme)
    );

    this.#theme.on(Theme.EVENTS.THEME_PARAMS_CHANGED, (themeParams) =>
      SessionStorage.set('themeParams', themeParams)
    );

    this.#theme.on(Theme.EVENTS.THEME_PARAM_SET, (param, value) => {
      const cssVar = 'theme-' + param.split('_').join('-');
      this.#setCssVar(cssVar, value);
    });

    if (rawTheme) {
      try {
        const parsedThemeParams = JSON.parse(rawTheme);

        if (parsedThemeParams) {
          this.#theme.setParams(parsedThemeParams);
        }
      } catch {}
    }

    const themeParams = SessionStorage.get<ThemeParams>('themeParams');
    if (themeParams) {
      this.#theme.setParams(themeParams);
    }
  }

  #initViewport(): void {
    this.#viewport.on(Viewport.EVENTS.VIEWPORT_CHANGED, (isStateStable) => {
      this.#receiveWebViewEvent('viewportChanged', { isStateStable });
    });

    this.#viewport.on(Viewport.EVENTS.HEIGHT_CALCULATED, ({ height, stableHeight }) => {
      this.#setCssVar('viewport-height', height);
      this.#setCssVar('viewport-stable-height', stableHeight);
    });
  }

  #initBgColor(): void {
    this.#bgColor.on(BackgroundColor.EVENTS.UPDATED, (maybeColor) => {
      this.#webView.postEvent('web_app_set_background_color', undefined, {
        color: maybeColor ?? '',
      });
    });
  }

  #initHapticFeedback(): void {
    this.#hapticFeedback[WebAppHapticFeedback.PRIVATE_KEYS.ON_EVENT](
      WebAppHapticFeedback.EVENTS.FEEDBACK_TRIGGERED,
      (feedback) => {
        this.#webView.postEvent('web_app_trigger_haptic_feedback', undefined, feedback);
      }
    );
  }

  constructor({
    initData,
    version,
    webView,
    bgColor,
    viewport,
    theme,
    backButton,
    mainButton,
    invoices,
    popup,
    clipboard,
    qrPopup,
    hapticFeedback,
  }: Dependencies) {
    this.#initData = initData;
    this.#version = version;
    this.#webView = webView;

    this.#bgColor = bgColor;
    this.#initBgColor();

    this.#viewport = viewport;
    this.#initViewport();

    this.#hapticFeedback = hapticFeedback;
    this.#initHapticFeedback();

    this.#backButton = backButton;
    this.#initBackButton();

    this.#mainButton = mainButton;
    this.#initMainButton();

    const { initParams } = this.#webView;

    this.#theme = theme;
    this.#initTheme(initParams.tgWebAppThemeParams);

    this.#popup = popup;

    if (initParams.tgWebAppVersion) {
      this.#version.set(initParams.tgWebAppVersion);
    }

    if (initParams.tgWebAppPlatform) {
      this.#platform = initParams.tgWebAppPlatform;
    }

    this.#invoices = invoices;
    this.#clipboard = clipboard;
    this.#qrPopup = qrPopup;

    this.#bgColor.update();
    this.#viewport.setHeight();

    window.addEventListener('resize', this.#onWindowResize);
    if (this.#webView.isIframe) {
      document.addEventListener('click', this.#linkHandler);
    }

    this.#webView.onEvent('theme_changed', this.#onThemeChanged);
    this.#webView.onEvent('viewport_changed', this.#onViewportChanged);
    this.#webView.onEvent('invoice_closed', this.#onInvoiceClosed);
    this.#webView.onEvent('settings_button_pressed', this.#onSettingsButtonPressed);
    this.#webView.onEvent('popup_closed', this.#onPopupClosed);
    this.#webView.onEvent('qr_text_received', this.#onQrTextReceived);
    this.#webView.onEvent('scan_qr_popup_closed', this.#onScanQrPopupClosed);
    this.#webView.onEvent('clipboard_text_received', this.#onClipboardTextReceived);
    this.#webView.postEvent('web_app_request_theme');
    this.#webView.postEvent('web_app_request_viewport');
  }

  get initData(): string {
    return this.#initData.rawData;
  }

  get initDataUnsafe(): WebAppInitData {
    return this.#initData.unsafeData;
  }

  get themeParams(): ThemeParams {
    return this.#theme.params;
  }

  get colorScheme(): ColorScheme {
    return this.#theme.colorScheme;
  }

  get version(): string {
    return this.#version.value;
  }

  get platform(): string {
    return this.#platform;
  }

  set headerColor(value: HeaderBgColor | HexColor) {
    this.setHeaderColor(value);
  }

  get headerColor(): HexColor {
    return this.#theme.getParam(this.#headerColorKey) ?? '';
  }

  set backgroundColor(color: HeaderBgColor | HexColor) {
    // FIXME: not supported in 6.1
    this.#bgColor.set(color);
  }

  get backgroundColor(): HexColor {
    return this.#bgColor.get() ?? '';
  }

  get HapticFeedback(): HapticFeedback {
    return this.#hapticFeedback;
  }

  get BackButton(): BackButton {
    return this.#backButton;
  }

  get MainButton(): MainButton {
    return this.#mainButton;
  }

  get viewportHeight(): number {
    return this.#viewport.height;
  }

  get viewportStableHeight(): number {
    return this.#viewport.stableHeight;
  }

  get isExpanded(): boolean {
    return this.#viewport.isExpanded;
  }

  set isClosingConfirmationEnabled(isEnabled: boolean) {
    this.#setClosingConfirmation(isEnabled);
  }

  get isClosingConfirmationEnabled(): boolean {
    return this.#isClosingConfirmationEnabled;
  }

  #linkHandler = (e: MouseEvent): void => {
    if (e.metaKey || e.ctrlKey || !e.target) {
      return;
    }

    const isAnchroEl = (el: HTMLElement): el is HTMLAnchorElement => el.tagName === 'A';

    let el = e.target as HTMLElement;

    while (!isAnchroEl(el) && el.parentNode) {
      el = el.parentNode as HTMLElement;
    }

    const shouldOpenLink =
      isAnchroEl(el) &&
      el.target !== '_blank' &&
      isHTTPTypeProtocol(el.protocol) &&
      isTelegramHostname(el.hostname);

    if (shouldOpenLink) {
      e.preventDefault();
      // WebApp.openTgLink(el.href);
    }
  };

  // `setCssProperty` originally
  #setCssVar(name: string, value: any): void {
    const root = document.documentElement;
    root?.style?.setProperty('--tg-' + name, value);
  }

  #receiveWebViewEvent(eventType: 'themeChanged'): void;
  #receiveWebViewEvent(eventType: 'backButtonClicked'): void;
  #receiveWebViewEvent(eventType: 'mainButtonClicked'): void;
  #receiveWebViewEvent(eventType: 'settingsButtonClicked'): void;
  #receiveWebViewEvent(eventType: 'viewportChanged', params: ViewportChangedCallbackData): void;
  #receiveWebViewEvent(eventType: 'popupClosed', params: PopupClosedCallbackData): void;
  #receiveWebViewEvent(eventType: 'qrTextReceived', params: QrTextReceivedCallbackData): void;
  #receiveWebViewEvent(
    eventType: 'clipboardTextReceived',
    params: ClipboardTextReceivedCallbackData
  ): void;
  #receiveWebViewEvent(eventType: 'invoiceClosed', params: InvoiceClosedCallbackData): void;
  #receiveWebViewEvent(eventType: WebViewEvent, params?: WebViewEventParams | undefined): void {
    const callbackArgs = params ? [params] : [];

    this.#webView.callEventCallbacks('webview:' + eventType, (callback) => {
      callback.apply(this, callbackArgs);
    });
  }

  #onWebViewEvent(eventType: string, callback: AnyCallback): void {
    this.#webView.onEvent('webview:' + eventType, callback);
  }

  #offWebViewEvent(eventType: string, callback: AnyCallback) {
    this.#webView.offEvent('webview:' + eventType, callback);
  }

  #onWindowResize = (): void => {
    if (this.#lastWindowHeight !== window.innerHeight) {
      this.#lastWindowHeight = window.innerHeight;

      this.#receiveWebViewEvent('viewportChanged', { isStateStable: true });
    }
  };

  #onInvoiceClosed = (_: any, { slug, status }: { slug?: string; status: InvoiceStatus }) => {
    if (!slug) {
      return;
    }

    if (!this.#invoices.has(slug)) {
      return;
    }

    const { url, callback } = this.#invoices.remove(slug)!;

    callback?.(status);

    this.#receiveWebViewEvent('invoiceClosed', { url, status });
  };

  #onThemeChanged = (_: any, eventData: { theme_params: ThemeParams }) => {
    if (!eventData.theme_params) {
      return;
    }

    this.#theme.setParams(eventData.theme_params);
    this.#mainButton.setParams({});
    this.#bgColor.update();
    this.#receiveWebViewEvent('themeChanged');
  };

  #onViewportChanged = (_: any, eventData: ViewportData): void => {
    if (!eventData.height) {
      return;
    }

    window.removeEventListener('resize', this.#onWindowResize);
    this.#viewport.setHeight(eventData);
  };

  #onSettingsButtonPressed = (): void => this.#receiveWebViewEvent('settingsButtonClicked');

  #onPopupClosed = (_: any, eventData: PopupClosedCallbackData): void => {
    if (!this.#popup.isOpened) {
      return;
    }

    const callback = this.#popup.callback;
    this.#popup.close();

    const buttonID = eventData.button_id ?? null;

    if (buttonID) {
      callback?.(buttonID);
    }

    this.#receiveWebViewEvent('popupClosed', { button_id: buttonID });
  };

  #onClipboardTextReceived = (
    _: any,
    {
      req_id: id,
      data = null,
    }: { req_id?: string | undefined; data?: string | '' | null | undefined }
  ) => {
    if (!id || !this.#clipboard.hasRequest(id)) {
      return;
    }

    const callback = this.#clipboard.getRequest(id);
    this.#clipboard.removeRequest(id);

    callback?.(data);

    this.#receiveWebViewEvent('clipboardTextReceived', { data });
  };

  #onQrTextReceived = (_: any, eventData: { data?: string | undefined }): void => {
    if (!this.#qrPopup.isOpened) {
      return;
    }

    const { callback } = this.#qrPopup;
    const data = eventData.data ?? null;

    if (callback?.(data)) {
      this.#qrPopup.close();
      this.#webView.postEvent('web_app_close_scan_qr_popup');
    }

    this.#receiveWebViewEvent('qrTextReceived', { data });
  };

  #onScanQrPopupClosed = (): void => this.#qrPopup.close();

  #setClosingConfirmation(isEnabled: boolean): void {
    if (!this.#version.isSuitableTo('6.2')) {
      console.warn(
        '[Telegram.WebApp] Closing confirmation is not supported in version ' + this.#version.value
      );

      return;
    }

    this.#isClosingConfirmationEnabled = Boolean(isEnabled);

    this.#webView.postEvent('web_app_setup_closing_behavior', undefined, {
      need_confirmation: this.#isClosingConfirmationEnabled,
    });
  }

  #getHeaderColorKey(colorKeyOrColor: HeaderBgColor | string): HeaderBgColor | false {
    if (
      colorKeyOrColor === HEADER_COLOR_KEYS.BG_COLOR ||
      colorKeyOrColor === HEADER_COLOR_KEYS.SECONDARY_BG_COLOR
    ) {
      return colorKeyOrColor;
    }

    const parsedColor = parseColorToHex(colorKeyOrColor);
    const themeParams = this.#theme.params;

    if (themeParams.bg_color && themeParams.bg_color === parsedColor) {
      return HEADER_COLOR_KEYS.BG_COLOR;
    }

    if (themeParams.secondary_bg_color && themeParams.secondary_bg_color === parsedColor) {
      return HEADER_COLOR_KEYS.SECONDARY_BG_COLOR;
    }

    return false;
  }

  setHeaderColor = (colorKeyOrColor: HeaderBgColor | string): void | never => {
    if (!this.#version.isSuitableTo('6.1')) {
      console.warn('[Telegram.WebApp] Header color is not supported in version ' + this.#version);
      return;
    }

    const colorKey = this.#getHeaderColorKey(colorKeyOrColor);

    if (
      colorKey !== HEADER_COLOR_KEYS.BG_COLOR &&
      colorKey !== HEADER_COLOR_KEYS.SECONDARY_BG_COLOR
    ) {
      console.error(
        "[Telegram.WebApp] Header color key should be one of Telegram.WebApp.themeParams.bg_color, Telegram.WebApp.themeParams.secondary_bg_color, 'bg_color', 'secondary_bg_color'",
        colorKeyOrColor
      );
      throw new Error('WebAppHeaderColorKeyInvalid');
    }

    this.#headerColorKey = colorKey;

    this.#webView.postEvent('web_app_set_header_color', undefined, { color_key: colorKey });
  };

  setBackgroundColor = (color: HeaderBgColor | string): void => {
    // FIXME: not supported in 6.1
    this.backgroundColor = color;
  };

  sendData = (data: string): void => {
    if (!data || !data.length) {
      console.error('[Telegram.WebApp] Data is required', data);
      throw new Error('WebAppDataInvalid');
    }

    if (byteLength(data) > TelegramWebApp.MAXIMUM_BYTES_TO_SEND) {
      console.error('[Telegram.WebApp] Data is too long', data);
      throw new Error('WebAppDataInvalid');
    }

    this.#webView.postEvent('web_app_data_send', undefined, { data });
  };

  isVersionAtLeast = (version: string): boolean => this.#version.isSuitableTo(version);

  openLink = (url: string, options?: Nullable<OpenLinkOptions>): void | never => {
    const { protocol } = new URL(url);

    if (!isHTTPTypeProtocol(protocol)) {
      throw new WebAppTelegramUrlInvalidError(`protocol is not supported ${url}`);
    }

    if (!this.#version.isSuitableTo('6.1')) {
      window.open(url, '_blank');
      return;
    }

    const linkOptions: OpenLinkOptions = options ?? { try_instant_view: false };

    this.#webView.postEvent('web_app_open_link', undefined, {
      url,
      try_instant_view: this.#version.isSuitableTo('6.4') && linkOptions.try_instant_view,
    });
  };

  // TODO: version 6.1+
  openInvoice = (url: string, callback?: Nullable<OpenInvoiceCallback>): void | never => {
    const slug = this.#invoices.create(url);
    this.#invoices.save(slug, { url, callback });

    this.#webView.postEvent('web_app_open_invoice', undefined, { slug });
  };

  openTelegramLink = (url: string): void => {
    if (!this.#version.isSuitableTo('6.1')) {
      return;
    }

    const { protocol, hostname, pathname, search } = new URL(url);

    if (!isHTTPTypeProtocol(protocol)) {
      throw new WebAppTelegramUrlInvalidError(`protocol is not supported ${url}`);
    }

    if (!isTelegramHostname(hostname)) {
      throw new WebAppTelegramUrlInvalidError(`host is not supported ${url}`);
    }

    const fullPath = pathname + search;

    if (this.#webView.isIframe) {
      this.#webView.postEvent('web_app_open_tg_link', undefined, { path_full: fullPath });
      return;
    }

    location.href = 'https://t.me' + fullPath;
  };

  readTextFromClipboard = (callback?: ClipboardCallback | null | undefined): void => {
    if (!this.#version.isSuitableTo('6.4')) {
      throw new WebAppMethodUnsupportedError('readTextFromClipboard', this.#version.value);
    }

    const id = generateId(16);

    this.#clipboard.setRequest(id, callback);

    this.#webView.postEvent('web_app_read_text_from_clipboard', undefined, { req_id: id });
  };

  enableClosingConfirmation = (): void | never => {
    this.#isClosingConfirmationEnabled = true;
  };

  disableClosingConfirmation = (): void | never => {
    this.#isClosingConfirmationEnabled = false;
  };

  showPopup(params: PopupParams, callback?: Nullable<ShowPopupCallback>): void | never {
    if (!this.#version.isSuitableTo('6.2')) {
      throw new WebAppMethodUnsupportedError('showPopup', this.#version.value);
    }

    if (this.#popup.isOpened) {
      throw new WebAppPopupOpenedError();
    }

    if (typeof params !== 'object' && params === null) {
      throw new WebAppPopupParamInvalidError(`params must be an object ${params}`);
    }

    this.#popup.open({ params, callback });

    const data = this.#popup.params ?? ({} as OpenPopupEventData);

    this.#webView.postEvent('web_app_open_popup', undefined, data);
  }

  showAlert = (message: string, callback?: Nullable<NoParamsCallback>): void => {
    const callbackWithoutID = (): void => callback?.();

    this.showPopup({ message }, callbackWithoutID);
  };

  showConfirm = (message: string, callback?: Nullable<ShowConfirmCallback>): void => {
    const OK_BTN_ID = 'ok';
    const popupCallback = (pressedBtnID: string) => callback?.(pressedBtnID === OK_BTN_ID);

    this.showPopup(
      {
        message,
        buttons: [
          new WebAppPopupButton({ type: WebAppPopupButton.TYPES.OK, id: OK_BTN_ID }).data,
          new WebAppPopupButton({ type: WebAppPopupButton.TYPES.CANCEL, id: '' }).data,
        ],
      },
      popupCallback
    );
  };

  switchInlineQuery = (
    query: string,
    chatTypesToChoose?: Nullable<ChatTypesToChoose>
  ): void | never => {
    if (!this.#version.isSuitableTo('6.7')) {
      throw new WebAppMethodUnsupportedError('switchInlineQuery', this.#version.value);
    }

    if (!this.#webView.initParams.tgWebAppBotInline) {
      console.error(
        '[Telegram.WebApp] Inline mode is disabled for this bot. Read more about inline mode: https://core.telegram.org/bots/inline'
      );
      throw new Error('WebAppInlineModeDisabled');
    }

    const queryToSend = (query || '').trim();

    if (queryToSend.length > TelegramWebApp.MAX_INLINE_QUERY_LENGTH) {
      console.error('[Telegram.WebApp] Inline query is too long', query);
      throw new Error('WebAppInlineQueryInvalid');
    }

    const chatTypes = chatTypesToChoose ? chatTypesToChoose : [];

    if (!Array.isArray(chatTypesToChoose)) {
      console.error('[Telegram.WebApp] Choose chat types should be an array', chatTypesToChoose);
      throw new Error('WebAppInlineChooseChatTypesInvalid');
    }

    // remove duplicates
    const chats = [...new Set(chatTypes)];

    chats.forEach((chat) => {
      if (!VALID_CHAT_TYPES.includes(chat)) {
        console.error('[Telegram.WebApp] Choose chat type is invalid', chat);
        throw Error('WebAppInlineChooseChatTypeInvalid');
      }
    });

    this.#webView.postEvent('web_app_switch_inline_query', undefined, {
      query: queryToSend,
      chat_types: chats,
    });
  };

  showScanQrPopup = (
    params: ScanQrPopupParams,
    callback?: Nullable<ShowScanQrPopupCallback>
  ): void | never => {
    if (!this.#version.isSuitableTo('6.4')) {
      throw new WebAppMethodUnsupportedError('showScanQrPopup', this.#version.value);
    }

    this.#qrPopup.open({ params, callback });

    this.#webView.postEvent('web_app_open_scan_qr_popup', undefined, this.#qrPopup.params);
  };

  closeScanQrPopup = (): void | never => {
    if (!this.#version.isSuitableTo('6.4')) {
      throw new WebAppMethodUnsupportedError('closeScanQrPopup', this.#version.value);
    }

    this.#qrPopup.close();

    this.#webView.postEvent('web_app_close_scan_qr_popup');
  };

  onEvent = (eventType: string, callback: AnyCallback): void => {
    this.#onWebViewEvent(eventType, callback);
  };

  offEvent = (eventType: string, callback: AnyCallback): void => {
    this.#offWebViewEvent(eventType, callback);
  };

  ready = (): void => {
    this.#webView.postEvent('web_app_ready');
  };

  expand = (): void => {
    this.#webView.postEvent('web_app_expand');
  };

  close = (): void => {
    this.#webView.postEvent('web_app_close');
  };
}
