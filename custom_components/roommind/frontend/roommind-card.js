(function(){var e=globalThis,t=e.ShadowRoot&&(e.ShadyCSS===void 0||e.ShadyCSS.nativeShadow)&&`adoptedStyleSheets`in Document.prototype&&`replace`in CSSStyleSheet.prototype,n=Symbol(),r=new WeakMap,i=class{constructor(e,t,r){if(this._$cssResult$=!0,r!==n)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o,n=this.t;if(t&&e===void 0){let t=n!==void 0&&n.length===1;t&&(e=r.get(n)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),t&&r.set(n,e))}return e}toString(){return this.cssText}},a=e=>new i(typeof e==`string`?e:e+``,void 0,n),o=(e,...t)=>new i(e.length===1?e[0]:t.reduce((t,n,r)=>t+(e=>{if(!0===e._$cssResult$)return e.cssText;if(typeof e==`number`)return e;throw Error(`Value passed to 'css' function must be a 'css' function result: `+e+`. Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.`)})(n)+e[r+1],e[0]),e,n),s=(n,r)=>{if(t)n.adoptedStyleSheets=r.map(e=>e instanceof CSSStyleSheet?e:e.styleSheet);else for(let t of r){let r=document.createElement(`style`),i=e.litNonce;i!==void 0&&r.setAttribute(`nonce`,i),r.textContent=t.cssText,n.appendChild(r)}},c=t?e=>e:e=>e instanceof CSSStyleSheet?(e=>{let t=``;for(let n of e.cssRules)t+=n.cssText;return a(t)})(e):e,{is:l,defineProperty:u,getOwnPropertyDescriptor:d,getOwnPropertyNames:ee,getOwnPropertySymbols:te,getPrototypeOf:ne}=Object,f=globalThis,re=f.trustedTypes,ie=re?re.emptyScript:``,ae=f.reactiveElementPolyfillSupport,p=(e,t)=>e,m={toAttribute(e,t){switch(t){case Boolean:e=e?ie:null;break;case Object:case Array:e=e==null?e:JSON.stringify(e)}return e},fromAttribute(e,t){let n=e;switch(t){case Boolean:n=e!==null;break;case Number:n=e===null?null:Number(e);break;case Object:case Array:try{n=JSON.parse(e)}catch{n=null}}return n}},h=(e,t)=>!l(e,t),oe={attribute:!0,type:String,converter:m,reflect:!1,useDefault:!1,hasChanged:h};Symbol.metadata??=Symbol(`metadata`),f.litPropertyMetadata??=new WeakMap;var g=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=oe){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){let n=Symbol(),r=this.getPropertyDescriptor(e,n,t);r!==void 0&&u(this.prototype,e,r)}}static getPropertyDescriptor(e,t,n){let{get:r,set:i}=d(this.prototype,e)??{get(){return this[t]},set(e){this[t]=e}};return{get:r,set(t){let a=r?.call(this);i?.call(this,t),this.requestUpdate(e,a,n)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??oe}static _$Ei(){if(this.hasOwnProperty(p(`elementProperties`)))return;let e=ne(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(p(`finalized`)))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(p(`properties`))){let e=this.properties,t=[...ee(e),...te(e)];for(let n of t)this.createProperty(n,e[n])}let e=this[Symbol.metadata];if(e!==null){let t=litPropertyMetadata.get(e);if(t!==void 0)for(let[e,n]of t)this.elementProperties.set(e,n)}this._$Eh=new Map;for(let[e,t]of this.elementProperties){let n=this._$Eu(e,t);n!==void 0&&this._$Eh.set(n,e)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){let t=[];if(Array.isArray(e)){let n=new Set(e.flat(1/0).reverse());for(let e of n)t.unshift(c(e))}else e!==void 0&&t.push(c(e));return t}static _$Eu(e,t){let n=t.attribute;return!1===n?void 0:typeof n==`string`?n:typeof e==`string`?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){let e=new Map,t=this.constructor.elementProperties;for(let n of t.keys())this.hasOwnProperty(n)&&(e.set(n,this[n]),delete this[n]);e.size>0&&(this._$Ep=e)}createRenderRoot(){let e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return s(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,n){this._$AK(e,n)}_$ET(e,t){let n=this.constructor.elementProperties.get(e),r=this.constructor._$Eu(e,n);if(r!==void 0&&!0===n.reflect){let i=(n.converter?.toAttribute===void 0?m:n.converter).toAttribute(t,n.type);this._$Em=e,i==null?this.removeAttribute(r):this.setAttribute(r,i),this._$Em=null}}_$AK(e,t){let n=this.constructor,r=n._$Eh.get(e);if(r!==void 0&&this._$Em!==r){let e=n.getPropertyOptions(r),i=typeof e.converter==`function`?{fromAttribute:e.converter}:e.converter?.fromAttribute===void 0?m:e.converter;this._$Em=r;let a=i.fromAttribute(t,e.type);this[r]=a??this._$Ej?.get(r)??a,this._$Em=null}}requestUpdate(e,t,n,r=!1,i){if(e!==void 0){let a=this.constructor;if(!1===r&&(i=this[e]),n??=a.getPropertyOptions(e),!((n.hasChanged??h)(i,t)||n.useDefault&&n.reflect&&i===this._$Ej?.get(e)&&!this.hasAttribute(a._$Eu(e,n))))return;this.C(e,t,n)}!1===this.isUpdatePending&&(this._$ES=this._$EP())}C(e,t,{useDefault:n,reflect:r,wrapped:i},a){n&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,a??t??this[e]),!0!==i||a!==void 0)||(this._$AL.has(e)||(this.hasUpdated||n||(t=void 0),this._$AL.set(e,t)),!0===r&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(e){Promise.reject(e)}let e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[e,t]of this._$Ep)this[e]=t;this._$Ep=void 0}let e=this.constructor.elementProperties;if(e.size>0)for(let[t,n]of e){let{wrapped:e}=n,r=this[t];!0!==e||this._$AL.has(t)||r===void 0||this.C(t,void 0,n,r)}}let e=!1,t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(e=>e.hostUpdate?.()),this.update(t)):this._$EM()}catch(t){throw e=!1,this._$EM(),t}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(e=>e.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(e=>this._$ET(e,this[e])),this._$EM()}updated(e){}firstUpdated(e){}};g.elementStyles=[],g.shadowRootOptions={mode:`open`},g[p(`elementProperties`)]=new Map,g[p(`finalized`)]=new Map,ae?.({ReactiveElement:g}),(f.reactiveElementVersions??=[]).push(`2.1.2`);var se=globalThis,ce=e=>e,_=se.trustedTypes,le=_?_.createPolicy(`lit-html`,{createHTML:e=>e}):void 0,ue=`$lit$`,v=`lit$${Math.random().toFixed(9).slice(2)}$`,de=`?`+v,fe=`<${de}>`,y=document,b=()=>y.createComment(``),x=e=>e===null||typeof e!=`object`&&typeof e!=`function`,pe=Array.isArray,me=e=>pe(e)||typeof e?.[Symbol.iterator]==`function`,S=`[ 	
\f\r]`,C=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,he=/-->/g,ge=/>/g,w=RegExp(`>|${S}(?:([^\\s"'>=/]+)(${S}*=${S}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,`g`),_e=/'/g,ve=/"/g,ye=/^(?:script|style|textarea|title)$/i,T=(e=>(t,...n)=>({_$litType$:e,strings:t,values:n}))(1),E=Symbol.for(`lit-noChange`),D=Symbol.for(`lit-nothing`),be=new WeakMap,O=y.createTreeWalker(y,129);function xe(e,t){if(!pe(e)||!e.hasOwnProperty(`raw`))throw Error(`invalid template strings array`);return le===void 0?t:le.createHTML(t)}var Se=(e,t)=>{let n=e.length-1,r=[],i,a=t===2?`<svg>`:t===3?`<math>`:``,o=C;for(let t=0;t<n;t++){let n=e[t],s,c,l=-1,u=0;for(;u<n.length&&(o.lastIndex=u,c=o.exec(n),c!==null);)u=o.lastIndex,o===C?c[1]===`!--`?o=he:c[1]===void 0?c[2]===void 0?c[3]!==void 0&&(o=w):(ye.test(c[2])&&(i=RegExp(`</`+c[2],`g`)),o=w):o=ge:o===w?c[0]===`>`?(o=i??C,l=-1):c[1]===void 0?l=-2:(l=o.lastIndex-c[2].length,s=c[1],o=c[3]===void 0?w:c[3]===`"`?ve:_e):o===ve||o===_e?o=w:o===he||o===ge?o=C:(o=w,i=void 0);let d=o===w&&e[t+1].startsWith(`/>`)?` `:``;a+=o===C?n+fe:l>=0?(r.push(s),n.slice(0,l)+ue+n.slice(l)+v+d):n+v+(l===-2?t:d)}return[xe(e,a+(e[n]||`<?>`)+(t===2?`</svg>`:t===3?`</math>`:``)),r]},k=class e{constructor({strings:t,_$litType$:n},r){let i;this.parts=[];let a=0,o=0,s=t.length-1,c=this.parts,[l,u]=Se(t,n);if(this.el=e.createElement(l,r),O.currentNode=this.el.content,n===2||n===3){let e=this.el.content.firstChild;e.replaceWith(...e.childNodes)}for(;(i=O.nextNode())!==null&&c.length<s;){if(i.nodeType===1){if(i.hasAttributes())for(let e of i.getAttributeNames())if(e.endsWith(ue)){let t=u[o++],n=i.getAttribute(e).split(v),r=/([.?@])?(.*)/.exec(t);c.push({type:1,index:a,name:r[2],strings:n,ctor:r[1]===`.`?we:r[1]===`?`?Te:r[1]===`@`?Ee:M}),i.removeAttribute(e)}else e.startsWith(v)&&(c.push({type:6,index:a}),i.removeAttribute(e));if(ye.test(i.tagName)){let e=i.textContent.split(v),t=e.length-1;if(t>0){i.textContent=_?_.emptyScript:``;for(let n=0;n<t;n++)i.append(e[n],b()),O.nextNode(),c.push({type:2,index:++a});i.append(e[t],b())}}}else if(i.nodeType===8){if(i.data===de)c.push({type:2,index:a});else{let e=-1;for(;(e=i.data.indexOf(v,e+1))!==-1;)c.push({type:7,index:a}),e+=v.length-1}}a++}}static createElement(e,t){let n=y.createElement(`template`);return n.innerHTML=e,n}};function A(e,t,n=e,r){if(t===E)return t;let i=r===void 0?n._$Cl:n._$Co?.[r],a=x(t)?void 0:t._$litDirective$;return i?.constructor!==a&&(i?._$AO?.(!1),a===void 0?i=void 0:(i=new a(e),i._$AT(e,n,r)),r===void 0?n._$Cl=i:(n._$Co??=[])[r]=i),i!==void 0&&(t=A(e,i._$AS(e,t.values),i,r)),t}var Ce=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:t},parts:n}=this._$AD,r=(e?.creationScope??y).importNode(t,!0);O.currentNode=r;let i=O.nextNode(),a=0,o=0,s=n[0];for(;s!==void 0;){if(a===s.index){let t;s.type===2?t=new j(i,i.nextSibling,this,e):s.type===1?t=new s.ctor(i,s.name,s.strings,this,e):s.type===6&&(t=new De(i,this,e)),this._$AV.push(t),s=n[++o]}a!==s?.index&&(i=O.nextNode(),a++)}return O.currentNode=y,r}p(e){let t=0;for(let n of this._$AV)n!==void 0&&(n.strings===void 0?n._$AI(e[t]):(n._$AI(e,n,t),t+=n.strings.length-2)),t++}},j=class e{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,n,r){this.type=2,this._$AH=D,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=n,this.options=r,this._$Cv=r?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode,t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=A(this,e,t),x(e)?e===D||e==null||e===``?(this._$AH!==D&&this._$AR(),this._$AH=D):e!==this._$AH&&e!==E&&this._(e):e._$litType$===void 0?e.nodeType===void 0?me(e)?this.k(e):this._(e):this.T(e):this.$(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==D&&x(this._$AH)?this._$AA.nextSibling.data=e:this.T(y.createTextNode(e)),this._$AH=e}$(e){let{values:t,_$litType$:n}=e,r=typeof n==`number`?this._$AC(e):(n.el===void 0&&(n.el=k.createElement(xe(n.h,n.h[0]),this.options)),n);if(this._$AH?._$AD===r)this._$AH.p(t);else{let e=new Ce(r,this),n=e.u(this.options);e.p(t),this.T(n),this._$AH=e}}_$AC(e){let t=be.get(e.strings);return t===void 0&&be.set(e.strings,t=new k(e)),t}k(t){pe(this._$AH)||(this._$AH=[],this._$AR());let n=this._$AH,r,i=0;for(let a of t)i===n.length?n.push(r=new e(this.O(b()),this.O(b()),this,this.options)):r=n[i],r._$AI(a),i++;i<n.length&&(this._$AR(r&&r._$AB.nextSibling,i),n.length=i)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){let t=ce(e).nextSibling;ce(e).remove(),e=t}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}},M=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,n,r,i){this.type=1,this._$AH=D,this._$AN=void 0,this.element=e,this.name=t,this._$AM=r,this.options=i,n.length>2||n[0]!==``||n[1]!==``?(this._$AH=Array(n.length-1).fill(new String),this.strings=n):this._$AH=D}_$AI(e,t=this,n,r){let i=this.strings,a=!1;if(i===void 0)e=A(this,e,t,0),a=!x(e)||e!==this._$AH&&e!==E,a&&(this._$AH=e);else{let r=e,o,s;for(e=i[0],o=0;o<i.length-1;o++)s=A(this,r[n+o],t,o),s===E&&(s=this._$AH[o]),a||=!x(s)||s!==this._$AH[o],s===D?e=D:e!==D&&(e+=(s??``)+i[o+1]),this._$AH[o]=s}a&&!r&&this.j(e)}j(e){e===D?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??``)}},we=class extends M{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===D?void 0:e}},Te=class extends M{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==D)}},Ee=class extends M{constructor(e,t,n,r,i){super(e,t,n,r,i),this.type=5}_$AI(e,t=this){if((e=A(this,e,t,0)??D)===E)return;let n=this._$AH,r=e===D&&n!==D||e.capture!==n.capture||e.once!==n.once||e.passive!==n.passive,i=e!==D&&(n===D||r);r&&this.element.removeEventListener(this.name,this,n),i&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH==`function`?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}},De=class{constructor(e,t,n){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=n}get _$AU(){return this._$AM._$AU}_$AI(e){A(this,e)}},Oe=se.litHtmlPolyfillSupport;Oe?.(k,j),(se.litHtmlVersions??=[]).push(`3.3.2`);var ke=(e,t,n)=>{let r=n?.renderBefore??t,i=r._$litPart$;if(i===void 0){let e=n?.renderBefore??null;r._$litPart$=i=new j(t.insertBefore(b(),e),e,void 0,n??{})}return i._$AI(e),i},N=globalThis,P=class extends g{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){let t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=ke(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return E}};P._$litElement$=!0,P.finalized=!0,N.litElementHydrateSupport?.({LitElement:P});var Ae=N.litElementPolyfillSupport;Ae?.({LitElement:P}),(N.litElementVersions??=[]).push(`4.2.2`);var je={attribute:!0,type:String,converter:m,reflect:!1,hasChanged:h},Me=(e=je,t,n)=>{let{kind:r,metadata:i}=n,a=globalThis.litPropertyMetadata.get(i);if(a===void 0&&globalThis.litPropertyMetadata.set(i,a=new Map),r===`setter`&&((e=Object.create(e)).wrapped=!0),a.set(n.name,e),r===`accessor`){let{name:r}=n;return{set(n){let i=t.get.call(this);t.set.call(this,n),this.requestUpdate(r,i,e,!0,n)},init(t){return t!==void 0&&this.C(r,void 0,e,t),t}}}if(r===`setter`){let{name:r}=n;return function(n){let i=this[r];t.call(this,n),this.requestUpdate(r,i,e,!0,n)}}throw Error(`Unsupported decorator location: `+r)};function Ne(e){return(t,n)=>typeof n==`object`?Me(e,t,n):((e,t,n)=>{let r=t.hasOwnProperty(n);return t.constructor.createProperty(n,e),r?Object.getOwnPropertyDescriptor(t,n):void 0})(e,t,n)}function F(e){return Ne({...e,state:!0,attribute:!1})}var I={en:{"room.climate_control_toggle":`Climate control`,"override.comfort":`Comfort`,"override.eco":`Eco`,"override.away":`Away`,"override.custom":`Custom`,"override.target":`Target`,"override.heat_to":`Heat to`,"override.cool_above":`Cool above`,"override.invalid_band":`Cooling target must be at or above the heating target`,"override.error_set":`Failed to change the temperature`,"override.error_clear":`Failed to end the temporary temperature`,"hero.target":`Target`,"hero.remaining":`{time} remaining`,"hero.heat_source_primary":`Heating with: radiators`,"hero.heat_source_secondary":`Heating with: AC`,"hero.heat_source_both":`Heating with: radiators and AC`,"hero.permanent":`Permanent`,"hero.waiting":`Waiting for readings…`,"hero.not_configured":`Not configured yet`,"hero.mpc_learning_paused":`Learning paused`,"hero.mpc_learning_paused.outdoor_unavailable":`To learn, RoomMind needs an outdoor temperature. The outdoor sensor reports nothing right now and no weather forecast is set. Set up one of them under Settings › Sensors & data sources.`,"hero.compressor_protection_min_off":`Compressor protection: minimum off time`,"hero.compressor_protection_min_run":`Compressor protection: minimum run time`,"hero.compressor_protection_info":`This room shares an outdoor unit with other rooms. So the compressor does not keep switching on and off, it has to run for a minimum time and then stay off for a minimum time. Until then this device does not switch.`,"hero.uniform_mode_info":`This room shares an outdoor unit set to "All in the same mode": all units heat or all cool. While the others run the other way, this room waits. When the outdoor unit switches, units still in the old mode go off first.`,"hero.coil_dry":`Drying ({time})`,"hero.coil_dry_drain":`Draining ({time})`,"hero.coil_dry_info":`The AC is drying its evaporator and switches off afterwards. If the room needs cooling, it stops at once.`,"card.target":`Target`,"card.waiting":`Waiting for readings…`,"card.humidity":`{value} humidity`,"card.thermostat":`Thermostat`,"card.ac":`AC`,"card.climate_device":`device`,"card.climate_devices":`devices`,"card.temp_sensor":`temperature sensor`,"card.temp_sensors":`temperature sensors`,"card.no_climate":`No device to heat or cool`,"card.outdoor":`Outdoor`,"card.mpc_active":`MPC active`,"card.mpc_learning":`MPC learning`,"card.compressor_min_run":`Min run {time}`,"card.compressor_min_off":`Min off {time}`,"card.uniform_mode_heat":`Outdoor unit heating`,"card.uniform_mode_cool":`Outdoor unit cooling`,"card.uniform_mode_switching":`Outdoor unit switching`,"card.not_controlled":`Not controlled by RoomMind`,"mode.auto":`Auto`,"mode.auto_desc":`Heats or cools, depending on where the room is against its target`,"mode.auto_desc_heat":`Heats when the room is too cold. Cooling needs an AC`,"mode.auto_desc_cool":`Cools when the room is too warm. No device here can heat`,"mode.heat_only":`Heat Only`,"mode.heat_only_desc":`Heats only. Next to thermostats the AC heats only with "Choose heat source" on`,"mode.heat_only_desc_plain":`Heats only, never cools`,"mode.cool_only":`Cool Only`,"mode.cool_only_desc":`Cools with the AC only, thermostats stay off`,"mode.cool_only_desc_plain":`Cools only, never heats`,"mode.unsupported":`No device in this room can do this. Pick another mode.`,"mode.heating":`Heating`,"mode.cooling":`Cooling`,"mode.idle":`Standby`,"hero.window_open":`Window open, paused`,"card.window_open":`Window open`,"card.presence_away":`Away`,"card.mold_warning":`Mold risk`,"card.mold_critical":`Mold danger`,"card.mold_prevention":`Mold prevention +{delta}`,"roomcard.name":`RoomMind room`,"roomcard.description":`Room status, quick choice for a temporary temperature, mode and comfort/eco values.`,"roomcard.no_area":`Choose a room in the card settings.`,"roomcard.loading":`Loading…`,"roomcard.unknown_room":`This room has no devices set up in RoomMind.`,"roomcard.open_room":`Open in RoomMind`,"roomcard.mode":`Mode`,"roomcard.temperatures":`Temperatures`,"roomcard.lower":`Lower {name}`,"roomcard.raise":`Raise {name}`,"roomcard.error_save":`Saving failed`,"roomcard.editor.area":`Room`,"roomcard.editor.hide_override":`Hide “Change the temperature for a while”`,"roomcard.editor.hide_mode":`Hide mode (auto, heat only, cool only)`,"roomcard.editor.hide_climate_control":`Hide climate control switch`,"roomcard.editor.hide_temperatures":`Hide comfort and eco temperatures`,"roomcard.paused":`paused`,"roomcard.editor.compact":`Compact layout`,"hero.price_charging":`Electricity cheap: target {value} to store heat`,"hero.price_coasting":`Electricity expensive: target {value} to save`,"hero.price_precooling":`Electricity cheap: target {value} to pre-cool`,"hero.control_off":`Climate control off`,"card.state.heating":`Heating`,"card.state.cooling":`Cooling`,"card.state.paused":`Paused`,"card.state.off":`Off`,"card.hint.not_controlled":`Not controlled`,"card.hint.override_until":`{type} until {time}`,"card.hint.override_permanent":`{type} · permanent`,"card.hint.override_paused":`{type} paused while away`,"card.hint.vacant":`Room empty`,"card.hint.price_cheap":`Power cheap {delta}`,"card.hint.price_expensive":`Power expensive {delta}`,"card.hint.preheat":`Heating ahead for {temp} from {time}`,"card.hint.precool":`Cooling ahead for {temp} from {time}`,"card.hint.setback":`Setback, stays on`,"card.hint.setback_until":`Setback, off in {time} without demand`,"hero.setback_info":`The room needs no heating or cooling right now. Devices with the idle action "Setback" stay on in their mode with a lowered setpoint, so they can pick up again quickly. With "Turn off after an hour without demand" they switch off once the hour is over and RoomMind does not need them in the next hour either.`,"card.control_off_global":`Climate control is off for all rooms`,"card.control_off_room":`Climate control is off for this room`,"card.measure_only":`Measuring only, no control`,"card.no_climate_hint":`Assign a thermostat or AC to this area in Home Assistant`,"card.not_set_up":`Not set up yet`,"card.set_up":`Set up`,"card.quick.schedule":`Schedule`,"card.quick.normal":`Normal`,"card.quick_label":`Quick choice for {name}`,"card.range_recent":`Last 6 h: {min} – {max}`,"detail.override.label":`Change the temperature for a while`,"detail.override.duration":`For how long?`,"duration.minutes":`{n} min`,"duration.hours":`{n} h`,"duration.hours_minutes":`{h} h {m} min`,"error.connection_lost":`No connection to Home Assistant. Try again once it is back.`,"error.unknown":`Unknown error`,"error.timeout":`Home Assistant did not answer in time. Try again.`,"error.unauthorized":`Only administrators can change this.`,"error.not_found":`This no longer exists. Reload the page.`,"error.invalid_format":`A value is out of its allowed range and was not saved.`,"error.no_coordinator":`RoomMind is still starting. Try again in a moment.`,"error.no_model":`This room has no learned model yet.`,"error.invalid_entity":`RoomMind's own entities cannot be used as a device or sensor.`,"error.duplicate_entity":`A device is listed twice.`,"error.duplicate_group_id":`Two groups have the same ID.`,"error.invalid_member":`Only climate entities can be group members.`,"error.duplicate_member":`A device can only be in one group.`,"error.invalid_master_entity":`The main device must be a climate, switch or input_boolean entity.`,"error.master_in_members":`The main device cannot also be a member of its group.`,"error.master_is_other_member":`The main device is a member of another group.`,"error.duplicate_master":`A main device can only belong to one group.`,"error.invalid_action_script":`The action must be a script entity.`,"error.schedule_no_entity":`The schedule was created, but Home Assistant has not listed it yet. Reload the page.`,"card.hint.air_co2":`CO₂ {value} ppm, air the room`,"card.hint.air_co2_venting":`CO₂ {value} ppm, ventilation on`,"card.hint.air_bad":`Poor air quality, air the room`,"card.hint.air_venting":`Poor air quality, ventilation on`,"card.hint.room_fan":`Room fan on`,"card.hint.humidity_high":`Humidity {value} %, too humid`,"card.hint.humidity_venting":`Humidity {value} %, ventilation on`,"card.hint.humidity_dehumidifying":`Humidity {value} %, dehumidifier on`,"card.hint.humidity_ac_drying":`Humidity {value} %, air conditioner drying`,"card.hint.humidity_outdoor_wetter":`Humidity {value} %, more humid outside`,"card.hint.humidity_low":`Humidity {value} %, too dry`,"card.hint.humidity_humidifying":`Humidity {value} %, humidifier on`,"card.hint.air_pm25":`PM2.5 {value} µg/m³, poor air`,"card.hint.air_pm25_venting":`PM2.5 {value} µg/m³, purifier/vent on`,"card.hint.air_pm10":`PM10 {value} µg/m³, poor air`,"card.hint.air_pm10_venting":`PM10 {value} µg/m³, purifier/vent on`,"card.hint.air_pm1":`PM1.0 {value} µg/m³, poor air`,"card.hint.air_pm1_venting":`PM1.0 {value} µg/m³, purifier/vent on`},de:{"room.climate_control_toggle":`Klimasteuerung`,"override.comfort":`Komfort`,"override.eco":`Eco`,"override.away":`Abwesend`,"override.custom":`Individuell`,"override.target":`Ziel`,"override.heat_to":`Heizen bis`,"override.cool_above":`Kühlen ab`,"override.invalid_band":`Das Kühlziel muss mindestens so hoch wie das Heizziel sein`,"override.error_set":`Temperatur konnte nicht geändert werden`,"override.error_clear":`Vorübergehende Temperatur konnte nicht beendet werden`,"hero.target":`Ziel`,"hero.remaining":`noch {time}`,"hero.heat_source_primary":`Heizt mit: Heizkörper`,"hero.heat_source_secondary":`Heizt mit: Klimagerät`,"hero.heat_source_both":`Heizt mit: Heizkörper und Klimagerät`,"hero.permanent":`Dauerhaft`,"hero.waiting":`Wartet auf Messwerte…`,"hero.not_configured":`Noch nicht konfiguriert`,"hero.mpc_learning_paused":`Lernen pausiert`,"hero.mpc_learning_paused.outdoor_unavailable":`Zum Lernen braucht RoomMind eine Außentemperatur. Der Außensensor liefert gerade nichts und es ist keine Wettervorhersage eingetragen. Eins von beiden unter Einstellungen › Sensoren & Datenquellen einrichten.`,"hero.compressor_protection_min_off":`Kompressorschutz: Mindestpause läuft`,"hero.compressor_protection_min_run":`Kompressorschutz: Mindestlaufzeit läuft`,"hero.compressor_protection_info":`Der Raum hängt mit anderen Räumen an einer Außeneinheit. Damit der Kompressor nicht ständig an- und ausgeht, muss er eine Mindestzeit laufen und danach eine Mindestzeit aus bleiben. Bis dahin schaltet dieses Gerät nicht um.`,"hero.uniform_mode_info":`Der Raum hängt an einer Außeneinheit mit „Alle im selben Modus“: alle Geräte heizen oder alle kühlen. Solange die anderen in die andere Richtung laufen, wartet dieser Raum. Schaltet die Außeneinheit um, gehen Geräte im alten Modus zuerst aus.`,"hero.coil_dry":`Trocknet ({time})`,"hero.coil_dry_drain":`Kondensat läuft ab ({time})`,"hero.coil_dry_info":`Das Klimagerät trocknet gerade seinen Verdampfer und schaltet danach ab. Braucht der Raum Kühlung, hört es sofort auf.`,"card.target":`Ziel`,"card.waiting":`Wartet auf Messwerte…`,"card.humidity":`{value} Luftfeuchte`,"card.thermostat":`Thermostat`,"card.ac":`Klimagerät`,"card.climate_device":`Gerät`,"card.climate_devices":`Geräte`,"card.temp_sensor":`Temperatursensor`,"card.temp_sensors":`Temperatursensoren`,"card.no_climate":`Kein Gerät zum Heizen oder Kühlen`,"card.outdoor":`Außen`,"card.mpc_active":`MPC aktiv`,"card.mpc_learning":`MPC lernt`,"card.compressor_min_run":`Mindestlauf {time}`,"card.compressor_min_off":`Mindestpause {time}`,"card.uniform_mode_heat":`Außeneinheit heizt`,"card.uniform_mode_cool":`Außeneinheit kühlt`,"card.uniform_mode_switching":`Außeneinheit schaltet um`,"card.not_controlled":`Nicht von RoomMind gesteuert`,"mode.auto":`Automatisch`,"mode.auto_desc":`Heizt oder kühlt, je nachdem, wo der Raum zum Ziel steht`,"mode.auto_desc_heat":`Heizt, wenn es zu kalt ist. Zum Kühlen fehlt ein Klimagerät`,"mode.auto_desc_cool":`Kühlt, wenn es zu warm ist. Kein Gerät im Raum kann heizen`,"mode.heat_only":`Nur Heizen`,"mode.heat_only_desc":`Nur Heizen. Neben Thermostaten heizt das Klimagerät nur, wenn „Heizquelle wählen“ an ist`,"mode.heat_only_desc_plain":`Nur Heizen, nie Kühlen`,"mode.cool_only":`Nur Kühlen`,"mode.cool_only_desc":`Kühlt nur mit dem Klimagerät, Thermostate bleiben aus`,"mode.cool_only_desc_plain":`Nur Kühlen, nie Heizen`,"mode.unsupported":`Das kann kein Gerät im Raum. Wähle einen anderen Modus.`,"mode.heating":`Heizen`,"mode.cooling":`Kühlen`,"mode.idle":`Standby`,"hero.window_open":`Fenster offen, pausiert`,"card.window_open":`Fenster offen`,"card.presence_away":`Abwesend`,"card.mold_warning":`Schimmelrisiko`,"card.mold_critical":`Schimmelgefahr`,"card.mold_prevention":`Schimmelschutz +{delta}`,"roomcard.name":`RoomMind-Raum`,"roomcard.description":`Raumstatus, Schnellwahl für eine vorübergehende Temperatur, Modus und Komfort-/Eco-Werte.`,"roomcard.no_area":`Wähle in den Karteneinstellungen einen Raum.`,"roomcard.loading":`Lädt…`,"roomcard.unknown_room":`Für diesen Raum sind in RoomMind keine Geräte eingerichtet.`,"roomcard.open_room":`In RoomMind öffnen`,"roomcard.mode":`Modus`,"roomcard.temperatures":`Temperaturen`,"roomcard.lower":`{name} senken`,"roomcard.raise":`{name} erhöhen`,"roomcard.error_save":`Speichern fehlgeschlagen`,"roomcard.editor.area":`Raum`,"roomcard.editor.hide_override":`„Temperatur vorübergehend ändern“ ausblenden`,"roomcard.editor.hide_mode":`Modus ausblenden (Automatisch, Nur Heizen, Nur Kühlen)`,"roomcard.editor.hide_climate_control":`Schalter für die Klimasteuerung ausblenden`,"roomcard.editor.hide_temperatures":`Komfort- und Eco-Temperaturen ausblenden`,"roomcard.paused":`pausiert`,"roomcard.editor.compact":`Kompakte Darstellung`,"hero.price_charging":`Strom günstig: Ziel {value} zum Vorheizen`,"hero.price_coasting":`Strom teuer: Ziel {value} zum Sparen`,"hero.price_precooling":`Strom günstig: Ziel {value} zum Vorkühlen`,"hero.control_off":`Klimasteuerung aus`,"card.state.heating":`Heizt`,"card.state.cooling":`Kühlt`,"card.state.paused":`Pausiert`,"card.state.off":`Aus`,"card.hint.not_controlled":`Nicht gesteuert`,"card.hint.override_until":`{type} bis {time}`,"card.hint.override_permanent":`{type} · dauerhaft`,"card.hint.override_paused":`{type} pausiert, niemand da`,"card.hint.vacant":`Raum leer`,"card.hint.price_cheap":`Strom günstig {delta}`,"card.hint.price_expensive":`Strom teuer {delta}`,"card.hint.preheat":`Heizt vor auf {temp} ab {time}`,"card.hint.precool":`Kühlt vor auf {temp} ab {time}`,"card.hint.setback":`Absenkung, bleibt an`,"card.hint.setback_until":`Absenkung, aus in {time} ohne Bedarf`,"hero.setback_info":`Der Raum braucht gerade weder Heizen noch Kühlen. Geräte mit der Leerlauf-Aktion „Absenkung“ bleiben in ihrem Modus an, nur mit abgesenktem Sollwert, damit sie schnell wieder übernehmen. Mit „Nach einer Stunde ohne Bedarf ausschalten“ gehen sie aus, sobald die Stunde um ist und RoomMind sie auch in der nächsten Stunde nicht braucht.`,"card.control_off_global":`Klimasteuerung für alle Räume aus`,"card.control_off_room":`Klimasteuerung für diesen Raum aus`,"card.measure_only":`Nur Messung, keine Regelung`,"card.no_climate_hint":`Ordne diesem Bereich in Home Assistant ein Thermostat oder Klimagerät zu`,"card.not_set_up":`Noch nicht eingerichtet`,"card.set_up":`Einrichten`,"card.quick.schedule":`Zeitplan`,"card.quick.normal":`Normal`,"card.quick_label":`Schnellwahl für {name}`,"card.range_recent":`Letzte 6 h: {min} – {max}`,"detail.override.label":`Temperatur vorübergehend ändern`,"detail.override.duration":`Wie lange?`,"duration.minutes":`{n} min`,"duration.hours":`{n} h`,"duration.hours_minutes":`{h} h {m} min`,"error.connection_lost":`Keine Verbindung zu Home Assistant. Sobald sie wieder steht, nochmal versuchen.`,"error.unknown":`Unbekannter Fehler`,"error.timeout":`Home Assistant hat nicht rechtzeitig geantwortet. Nochmal versuchen.`,"error.unauthorized":`Das dürfen nur Administratoren ändern.`,"error.not_found":`Das gibt es nicht mehr. Seite neu laden.`,"error.invalid_format":`Ein Wert liegt außerhalb des erlaubten Bereichs und wurde nicht gespeichert.`,"error.no_coordinator":`RoomMind startet noch. Gleich nochmal versuchen.`,"error.no_model":`Für diesen Raum gibt es noch kein gelerntes Modell.`,"error.invalid_entity":`RoomMinds eigene Entitäten können nicht als Gerät oder Sensor dienen.`,"error.duplicate_entity":`Ein Gerät ist doppelt eingetragen.`,"error.duplicate_group_id":`Zwei Gruppen haben dieselbe ID.`,"error.invalid_member":`Nur Klima-Entitäten können Mitglied einer Gruppe sein.`,"error.duplicate_member":`Ein Gerät kann nur in einer Gruppe sein.`,"error.invalid_master_entity":`Das Hauptgerät muss eine Klima-, switch- oder input_boolean-Entität sein.`,"error.master_in_members":`Das Hauptgerät kann nicht zugleich Mitglied seiner Gruppe sein.`,"error.master_is_other_member":`Das Hauptgerät ist Mitglied einer anderen Gruppe.`,"error.duplicate_master":`Ein Hauptgerät kann nur zu einer Gruppe gehören.`,"error.invalid_action_script":`Die Aktion muss eine Skript-Entität sein.`,"error.schedule_no_entity":`Der Zeitplan wurde angelegt, Home Assistant führt ihn aber noch nicht. Seite neu laden.`,"card.hint.air_co2":`CO₂ {value} ppm, bitte lüften`,"card.hint.air_co2_venting":`CO₂ {value} ppm, Lüftung läuft`,"card.hint.air_bad":`Luft belastet, bitte lüften`,"card.hint.air_venting":`Luft belastet, Lüftung läuft`,"card.hint.room_fan":`Raumlüfter läuft`,"card.hint.humidity_high":`Luftfeuchte {value} %, zu feucht`,"card.hint.humidity_venting":`Luftfeuchte {value} %, Lüftung läuft`,"card.hint.humidity_dehumidifying":`Luftfeuchte {value} %, Entfeuchter läuft`,"card.hint.humidity_ac_drying":`Luftfeuchte {value} %, Klimaanlage entfeuchtet`,"card.hint.humidity_outdoor_wetter":`Luftfeuchte {value} %, draußen feuchter`,"card.hint.humidity_low":`Luftfeuchte {value} %, zu trocken`,"card.hint.humidity_humidifying":`Luftfeuchte {value} %, Befeuchter läuft`},fr:{"room.climate_control_toggle":`Contrôle climatique`,"override.comfort":`Confort`,"override.eco":`Éco`,"override.away":`Absence`,"override.custom":`Personnalisé`,"override.target":`Cible`,"override.heat_to":`Chauffer jusqu'à`,"override.cool_above":`Refroidir au-dessus de`,"override.invalid_band":`La cible de refroidissement doit être supérieure ou égale à la cible de chauffage`,"override.error_set":`Impossible de changer la température`,"override.error_clear":`Impossible de mettre fin à la température temporaire`,"hero.target":`Cible`,"hero.remaining":`{time} restant`,"hero.heat_source_primary":`Chauffe avec : radiateurs`,"hero.heat_source_secondary":`Chauffe avec : climatiseur`,"hero.heat_source_both":`Chauffe avec : radiateurs et climatiseur`,"hero.permanent":`Permanent`,"hero.waiting":`En attente de mesures…`,"hero.not_configured":`Pas encore configuré`,"hero.mpc_learning_paused":`Apprentissage en pause`,"hero.mpc_learning_paused.outdoor_unavailable":`Pour apprendre, RoomMind a besoin d'une température extérieure. Le capteur extérieur ne donne rien pour l'instant et aucune prévision météo n'est définie. Configurez l'un des deux sous Paramètres › Capteurs et sources de données.`,"hero.compressor_protection_min_off":`Protection du compresseur : arrêt minimal en cours`,"hero.compressor_protection_min_run":`Protection du compresseur : marche minimale en cours`,"hero.compressor_protection_info":`Cette pièce partage une unité extérieure avec d'autres pièces. Pour que le compresseur ne s'allume et ne s'éteigne pas sans cesse, il doit tourner un temps minimal puis rester arrêté un temps minimal. D'ici là, cet appareil ne change pas d'état.`,"hero.uniform_mode_info":`Cette pièce partage une unité extérieure réglée sur « Tous dans le même mode » : toutes les unités chauffent ou toutes refroidissent. Tant que les autres fonctionnent dans l'autre sens, cette pièce attend. Quand l'unité extérieure change de mode, les unités encore dans l'ancien mode s'éteignent d'abord.`,"hero.coil_dry":`Séchage ({time})`,"hero.coil_dry_drain":`Écoulement ({time})`,"hero.coil_dry_info":`Le climatiseur sèche son évaporateur puis s'arrête. Si la pièce a besoin de froid, il s'interrompt aussitôt.`,"card.target":`Cible`,"card.waiting":`En attente de mesures…`,"card.humidity":`{value} humidité`,"card.thermostat":`Thermostat`,"card.ac":`Climatiseur`,"card.climate_device":`appareil`,"card.climate_devices":`appareils`,"card.temp_sensor":`capteur de température`,"card.temp_sensors":`capteurs de température`,"card.no_climate":`Aucun appareil pour chauffer ou refroidir`,"card.outdoor":`Extérieur`,"card.mpc_active":`MPC actif`,"card.mpc_learning":`MPC en apprentissage`,"card.compressor_min_run":`Marche min. {time}`,"card.compressor_min_off":`Arrêt min. {time}`,"card.uniform_mode_heat":`Unité extérieure en chauffage`,"card.uniform_mode_cool":`Unité extérieure en refroidissement`,"card.uniform_mode_switching":`Unité extérieure change de mode`,"card.not_controlled":`Pas contrôlé par RoomMind`,"mode.auto":`Auto`,"mode.auto_desc":`Chauffe ou refroidit selon l'écart de la pièce avec sa cible`,"mode.auto_desc_heat":`Chauffe quand la pièce est trop froide. Pour refroidir, il faut un climatiseur`,"mode.auto_desc_cool":`Refroidit quand la pièce est trop chaude. Aucun appareil ici ne chauffe`,"mode.heat_only":`Chauffer seulement`,"mode.heat_only_desc":`Chauffage uniquement. À côté des thermostats, le climatiseur ne chauffe qu'avec « Choisir la source de chaleur » activé`,"mode.heat_only_desc_plain":`Chauffe uniquement, ne refroidit jamais`,"mode.cool_only":`Refroidir seulement`,"mode.cool_only_desc":`Refroidit uniquement avec le climatiseur, les thermostats restent éteints`,"mode.cool_only_desc_plain":`Refroidit uniquement, ne chauffe jamais`,"mode.unsupported":`Aucun appareil de la pièce ne sait le faire. Choisissez un autre mode.`,"mode.heating":`Chauffage`,"mode.cooling":`Refroidissement`,"mode.idle":`En veille`,"hero.window_open":`Fenêtre ouverte - en pause`,"card.window_open":`Fenêtre ouverte`,"card.presence_away":`Absent`,"card.mold_warning":`Risque de moisissure`,"card.mold_critical":`Danger de moisissure`,"card.mold_prevention":`Prévention de la moisissure +{delta}`,"roomcard.name":`Pièce RoomMind`,"roomcard.description":`État de la pièce, choix rapide d'une température temporaire, mode et valeurs confort/éco.`,"roomcard.no_area":`Choisissez une pièce dans les paramètres de la carte.`,"roomcard.loading":`Chargement…`,"roomcard.unknown_room":`Aucun appareil n'est configuré pour cette pièce dans RoomMind.`,"roomcard.open_room":`Ouvrir dans RoomMind`,"roomcard.mode":`Mode`,"roomcard.temperatures":`Températures`,"roomcard.lower":`Baisser {name}`,"roomcard.raise":`Augmenter {name}`,"roomcard.error_save":`Échec de l'enregistrement`,"roomcard.editor.area":`Pièce`,"roomcard.editor.hide_override":`Masquer « Changer la température temporairement »`,"roomcard.editor.hide_mode":`Masquer le mode (auto, chauffer seulement, refroidir seulement)`,"roomcard.editor.hide_climate_control":`Masquer l'interrupteur du contrôle climatique`,"roomcard.editor.hide_temperatures":`Masquer les températures confort et éco`,"roomcard.paused":`en pause`,"roomcard.editor.compact":`Affichage compact`,"hero.price_charging":`Électricité bon marché : cible {value} pour stocker`,"hero.price_coasting":`Électricité chère : cible {value} pour économiser`,"hero.price_precooling":`Électricité bon marché : cible {value} pour prérefroidir`,"hero.control_off":`Contrôle climatique coupé`,"card.state.heating":`Chauffe`,"card.state.cooling":`Refroidit`,"card.state.paused":`En pause`,"card.state.off":`Arrêt`,"card.hint.not_controlled":`Non piloté`,"card.hint.override_until":`{type} jusqu'à {time}`,"card.hint.override_permanent":`{type} · permanent`,"card.hint.override_paused":`{type} en pause pendant l'absence`,"card.hint.vacant":`Pièce vide`,"card.hint.price_cheap":`Électricité bon marché {delta}`,"card.hint.price_expensive":`Électricité chère {delta}`,"card.hint.preheat":`Préchauffe pour {temp} dès {time}`,"card.hint.precool":`Prérefroidit pour {temp} dès {time}`,"card.hint.setback":`Décalage, reste allumé`,"card.hint.setback_until":`Décalage, arrêt dans {time} sans besoin`,"hero.setback_info":`La pièce n'a besoin ni de chauffage ni de refroidissement pour l'instant. Les appareils avec l'action au repos « Décalage » restent allumés dans leur mode avec une consigne décalée, pour reprendre vite. Avec « Éteindre après une heure sans besoin », ils s'éteignent une fois l'heure passée si RoomMind n'en a pas besoin dans l'heure suivante non plus.`,"card.control_off_global":`Régulation désactivée pour toutes les pièces`,"card.control_off_room":`Régulation désactivée pour cette pièce`,"card.measure_only":`Mesure seule, sans régulation`,"card.no_climate_hint":`Attribuez un thermostat ou un climatiseur à cette pièce dans Home Assistant`,"card.not_set_up":`Pas encore configurée`,"card.set_up":`Configurer`,"card.quick.schedule":`Planning`,"card.quick.normal":`Normal`,"card.quick_label":`Choix rapide pour {name}`,"card.range_recent":`6 dernières h : {min} – {max}`,"detail.override.label":`Changer la température temporairement`,"detail.override.duration":`Pour combien de temps ?`,"duration.minutes":`{n} min`,"duration.hours":`{n} h`,"duration.hours_minutes":`{h} h {m} min`,"error.connection_lost":`Pas de connexion à Home Assistant. Réessayez quand elle est rétablie.`,"error.unknown":`Erreur inconnue`,"error.timeout":`Home Assistant n'a pas répondu à temps. Réessayez.`,"error.unauthorized":`Seuls les administrateurs peuvent modifier ceci.`,"error.not_found":`Cet élément n'existe plus. Rechargez la page.`,"error.invalid_format":`Une valeur est hors de la plage autorisée et n'a pas été enregistrée.`,"error.no_coordinator":`RoomMind démarre encore. Réessayez dans un instant.`,"error.no_model":`Cette pièce n'a pas encore de modèle appris.`,"error.invalid_entity":`Les entités de RoomMind ne peuvent pas servir d'appareil ou de capteur.`,"error.duplicate_entity":`Un appareil figure deux fois.`,"error.duplicate_group_id":`Deux groupes ont le même ID.`,"error.invalid_member":`Seules les entités climate peuvent être membres d'un groupe.`,"error.duplicate_member":`Un appareil ne peut être que dans un seul groupe.`,"error.invalid_master_entity":`L'appareil principal doit être une entité climate, switch ou input_boolean.`,"error.master_in_members":`L'appareil principal ne peut pas être aussi membre de son groupe.`,"error.master_is_other_member":`L'appareil principal est membre d'un autre groupe.`,"error.duplicate_master":`Un appareil principal ne peut appartenir qu'à un seul groupe.`,"error.invalid_action_script":`L'action doit être une entité script.`,"error.schedule_no_entity":`Le planning a été créé, mais Home Assistant ne l'affiche pas encore. Rechargez la page.`,"card.hint.air_co2":`CO₂ {value} ppm, aérez la pièce`,"card.hint.air_co2_venting":`CO₂ {value} ppm, ventilation en marche`,"card.hint.air_bad":`Air de mauvaise qualité, aérez la pièce`,"card.hint.air_venting":`Air de mauvaise qualité, ventilation en marche`,"card.hint.room_fan":`Ventilateur en marche`,"card.hint.humidity_high":`Humidité {value} %, trop humide`,"card.hint.humidity_venting":`Humidité {value} %, ventilation en marche`,"card.hint.humidity_dehumidifying":`Humidité {value} %, déshumidificateur en marche`,"card.hint.humidity_ac_drying":`Humidité {value} %, climatiseur en déshumidification`,"card.hint.humidity_outdoor_wetter":`Humidité {value} %, plus humide dehors`,"card.hint.humidity_low":`Humidité {value} %, trop sèche`,"card.hint.humidity_humidifying":`Humidité {value} %, humidificateur en marche`},it:{"room.climate_control_toggle":`Controllo climatizzazione`,"override.comfort":`Comfort`,"override.eco":`Eco`,"override.away":`Assenza`,"override.custom":`Personalizzata`,"override.target":`Obiettivo`,"override.heat_to":`Riscalda fino a`,"override.cool_above":`Raffresca sopra`,"override.invalid_band":`L'obiettivo di raffrescamento deve essere uguale o superiore a quello di riscaldamento`,"override.error_set":`Impossibile cambiare la temperatura`,"override.error_clear":`Impossibile terminare la temperatura temporanea`,"hero.target":`Obiettivo`,"hero.remaining":`{time} rimanenti`,"hero.heat_source_primary":`Riscalda con: termosifoni`,"hero.heat_source_secondary":`Riscalda con: climatizzatore`,"hero.heat_source_both":`Riscalda con: termosifoni e climatizzatore`,"hero.permanent":`Permanente`,"hero.waiting":`In attesa di misure…`,"hero.not_configured":`Non ancora configurata`,"hero.mpc_learning_paused":`Apprendimento in pausa`,"hero.mpc_learning_paused.outdoor_unavailable":`Per imparare RoomMind ha bisogno di una temperatura esterna. Il sensore esterno ora non fornisce nulla e non è impostata alcuna previsione meteo. Configurane uno in Impostazioni › Sensori e fonti dati.`,"hero.compressor_protection_min_off":`Protezione compressore: pausa minima in corso`,"hero.compressor_protection_min_run":`Protezione compressore: funzionamento minimo in corso`,"hero.compressor_protection_info":`Questa stanza condivide un'unità esterna con altre stanze. Perché il compressore non si accenda e spenga di continuo, deve funzionare per un tempo minimo e poi restare spento per un tempo minimo. Fino ad allora questo dispositivo non cambia stato.`,"hero.uniform_mode_info":`Questa stanza condivide un'unità esterna impostata su «Tutti nella stessa modalità»: tutte le unità riscaldano o tutte raffrescano. Finché le altre funzionano nel verso opposto, questa stanza aspetta. Quando l'unità esterna cambia modalità, le unità ancora nella vecchia modalità si spengono prima.`,"hero.coil_dry":`Asciugatura ({time})`,"hero.coil_dry_drain":`Scarico ({time})`,"hero.coil_dry_info":`Il climatizzatore sta asciugando l'evaporatore e poi si spegne. Se la stanza deve essere raffrescata, smette subito.`,"card.target":`Obiettivo`,"card.waiting":`In attesa di misure…`,"card.humidity":`{value} di umidità`,"card.thermostat":`Termostato`,"card.ac":`Climatizzatore`,"card.climate_device":`dispositivo`,"card.climate_devices":`dispositivi`,"card.temp_sensor":`sensore di temperatura`,"card.temp_sensors":`sensori di temperatura`,"card.no_climate":`Nessun dispositivo per riscaldare o raffrescare`,"card.outdoor":`Esterno`,"card.mpc_active":`MPC attivo`,"card.mpc_learning":`MPC in apprendimento`,"card.compressor_min_run":`Funz. minimo {time}`,"card.compressor_min_off":`Pausa minima {time}`,"card.uniform_mode_heat":`Unità esterna in riscaldamento`,"card.uniform_mode_cool":`Unità esterna in raffrescamento`,"card.uniform_mode_switching":`Unità esterna cambia modalità`,"card.not_controlled":`Non controllata da RoomMind`,"mode.auto":`Auto`,"mode.auto_desc":`Riscalda o raffresca a seconda di dove si trova la stanza rispetto all'obiettivo`,"mode.auto_desc_heat":`Riscalda quando la stanza è troppo fredda. Per raffrescare serve un climatizzatore`,"mode.auto_desc_cool":`Raffresca quando la stanza è troppo calda. Nessun dispositivo qui riscalda`,"mode.heat_only":`Solo riscaldamento`,"mode.heat_only_desc":`Solo riscaldamento. Accanto ai termostati il climatizzatore riscalda solo con «Scegli la fonte di calore» attivo`,"mode.heat_only_desc_plain":`Solo riscaldamento, mai raffrescamento`,"mode.cool_only":`Solo raffrescamento`,"mode.cool_only_desc":`Raffresca solo con il climatizzatore, i termostati restano spenti`,"mode.cool_only_desc_plain":`Solo raffrescamento, mai riscaldamento`,"mode.unsupported":`Nessun dispositivo della stanza può farlo. Scegli un'altra modalità.`,"mode.heating":`Riscaldamento`,"mode.cooling":`Raffrescamento`,"mode.idle":`Standby`,"hero.window_open":`Finestra aperta, in pausa`,"card.window_open":`Finestra aperta`,"card.presence_away":`Fuori casa`,"card.mold_warning":`Rischio muffa`,"card.mold_critical":`Pericolo muffa`,"card.mold_prevention":`Prevenzione muffa +{delta}`,"roomcard.name":`Stanza RoomMind`,"roomcard.description":`Stato della stanza, scelta rapida di una temperatura temporanea, modalità e valori comfort/eco.`,"roomcard.no_area":`Scegli una stanza nelle impostazioni della scheda.`,"roomcard.loading":`Caricamento…`,"roomcard.unknown_room":`Per questa stanza non è configurato nessun dispositivo in RoomMind.`,"roomcard.open_room":`Apri in RoomMind`,"roomcard.mode":`Modalità`,"roomcard.temperatures":`Temperature`,"roomcard.lower":`Abbassa {name}`,"roomcard.raise":`Alza {name}`,"roomcard.error_save":`Salvataggio non riuscito`,"roomcard.editor.area":`Stanza`,"roomcard.editor.hide_override":`Nascondi «Cambia temporaneamente la temperatura»`,"roomcard.editor.hide_mode":`Nascondi modalità (auto, solo riscaldamento, solo raffrescamento)`,"roomcard.editor.hide_climate_control":`Nascondi interruttore del controllo climatizzazione`,"roomcard.editor.hide_temperatures":`Nascondi temperature comfort ed eco`,"roomcard.paused":`in pausa`,"roomcard.editor.compact":`Visualizzazione compatta`,"hero.price_charging":`Elettricità economica: obiettivo {value} per accumulare`,"hero.price_coasting":`Elettricità cara: obiettivo {value} per risparmiare`,"hero.price_precooling":`Elettricità economica: obiettivo {value} per pre-raffreddare`,"hero.control_off":`Controllo del clima spento`,"card.state.heating":`Riscalda`,"card.state.cooling":`Raffresca`,"card.state.paused":`In pausa`,"card.state.off":`Spenta`,"card.hint.not_controlled":`Non controllata`,"card.hint.override_until":`{type} fino alle {time}`,"card.hint.override_permanent":`{type} · permanente`,"card.hint.override_paused":`{type} in pausa durante l'assenza`,"card.hint.vacant":`Stanza vuota`,"card.hint.price_cheap":`Elettricità economica {delta}`,"card.hint.price_expensive":`Elettricità cara {delta}`,"card.hint.preheat":`Preriscalda per {temp} dalle {time}`,"card.hint.precool":`Preraffredda per {temp} dalle {time}`,"card.hint.setback":`Riduzione, resta acceso`,"card.hint.setback_until":`Riduzione, spento tra {time} senza richiesta`,"hero.setback_info":`La stanza al momento non ha bisogno né di riscaldamento né di raffrescamento. I dispositivi con l'azione a riposo «Riduzione» restano accesi nella loro modalità con un setpoint ridotto, così possono riprendere in fretta. Con «Spegni dopo un'ora senza richiesta» si spengono passata l'ora, se RoomMind non ne ha bisogno nemmeno nell'ora successiva.`,"card.control_off_global":`Controllo clima spento per tutte le stanze`,"card.control_off_room":`Controllo clima spento per questa stanza`,"card.measure_only":`Solo misura, nessuna regolazione`,"card.no_climate_hint":`Assegna un termostato o un climatizzatore a quest'area in Home Assistant`,"card.not_set_up":`Non ancora configurata`,"card.set_up":`Configura`,"card.quick.schedule":`Programma`,"card.quick.normal":`Normale`,"card.quick_label":`Scelta rapida per {name}`,"card.range_recent":`Ultime 6 h: {min} – {max}`,"detail.override.label":`Cambia temporaneamente la temperatura`,"detail.override.duration":`Per quanto tempo?`,"duration.minutes":`{n} min`,"duration.hours":`{n} h`,"duration.hours_minutes":`{h} h {m} min`,"error.connection_lost":`Nessuna connessione a Home Assistant. Riprova quando torna disponibile.`,"error.unknown":`Errore sconosciuto`,"error.timeout":`Home Assistant non ha risposto in tempo. Riprova.`,"error.unauthorized":`Solo gli amministratori possono modificarlo.`,"error.not_found":`Questo elemento non esiste più. Ricarica la pagina.`,"error.invalid_format":`Un valore è fuori dall'intervallo consentito e non è stato salvato.`,"error.no_coordinator":`RoomMind si sta ancora avviando. Riprova tra un momento.`,"error.no_model":`Questa stanza non ha ancora un modello appreso.`,"error.invalid_entity":`Le entità di RoomMind non possono essere usate come dispositivo o sensore.`,"error.duplicate_entity":`Un dispositivo è presente due volte.`,"error.duplicate_group_id":`Due gruppi hanno lo stesso ID.`,"error.invalid_member":`Solo le entità climate possono far parte di un gruppo.`,"error.duplicate_member":`Un dispositivo può stare in un solo gruppo.`,"error.invalid_master_entity":`Il dispositivo principale deve essere un'entità climate, switch o input_boolean.`,"error.master_in_members":`Il dispositivo principale non può essere anche membro del suo gruppo.`,"error.master_is_other_member":`Il dispositivo principale fa parte di un altro gruppo.`,"error.duplicate_master":`Un dispositivo principale può appartenere a un solo gruppo.`,"error.invalid_action_script":`L'azione deve essere un'entità script.`,"error.schedule_no_entity":`La programmazione è stata creata, ma Home Assistant non la elenca ancora. Ricarica la pagina.`,"card.hint.air_co2":`CO₂ {value} ppm, arieggia la stanza`,"card.hint.air_co2_venting":`CO₂ {value} ppm, ventilazione attiva`,"card.hint.air_bad":`Aria di scarsa qualità, arieggia la stanza`,"card.hint.air_venting":`Aria di scarsa qualità, ventilazione attiva`,"card.hint.room_fan":`Ventilatore acceso`,"card.hint.humidity_high":`Umidità {value} %, troppo umida`,"card.hint.humidity_venting":`Umidità {value} %, ventilazione attiva`,"card.hint.humidity_dehumidifying":`Umidità {value} %, deumidificatore attivo`,"card.hint.humidity_ac_drying":`Umidità {value} %, condizionatore in deumidificazione`,"card.hint.humidity_outdoor_wetter":`Umidità {value} %, fuori più umido`,"card.hint.humidity_low":`Umidità {value} %, troppo secca`,"card.hint.humidity_humidifying":`Umidità {value} %, umidificatore attivo`},es:{"room.climate_control_toggle":`Control de climatización`,"override.comfort":`Confort`,"override.eco":`Eco`,"override.away":`Ausente`,"override.custom":`Personalizada`,"override.target":`Objetivo`,"override.heat_to":`Calentar a`,"override.cool_above":`Enfriar por encima de`,"override.invalid_band":`El objetivo de refrigeración debe ser igual o superior al de calefacción`,"override.error_set":`No se pudo cambiar la temperatura`,"override.error_clear":`No se pudo terminar la temperatura temporal`,"hero.target":`Objetivo`,"hero.remaining":`Quedan {time}`,"hero.heat_source_primary":`Calentando con: radiadores`,"hero.heat_source_secondary":`Calentando con: aire acondicionado`,"hero.heat_source_both":`Calentando con: radiadores y aire acondicionado`,"hero.permanent":`Permanente`,"hero.waiting":`Esperando lecturas…`,"hero.not_configured":`Aún sin configurar`,"hero.mpc_learning_paused":`Aprendizaje en pausa`,"hero.mpc_learning_paused.outdoor_unavailable":`Para aprender, RoomMind necesita una temperatura exterior. Ahora mismo el sensor exterior no informa de nada y no hay ninguna previsión meteorológica configurada. Configura uno de los dos en Ajustes › Sensores y fuentes de datos.`,"hero.compressor_protection_min_off":`Protección del compresor: tiempo mínimo de apagado`,"hero.compressor_protection_min_run":`Protección del compresor: tiempo mínimo de funcionamiento`,"hero.compressor_protection_info":`Esta habitación comparte una unidad exterior con otras habitaciones. Para que el compresor no se encienda y se apague continuamente, tiene que funcionar un tiempo mínimo y después quedarse apagado otro tiempo mínimo. Hasta entonces, este dispositivo no cambia de estado.`,"hero.uniform_mode_info":`Esta habitación comparte una unidad exterior configurada como "Todas en el mismo modo": todas las unidades calientan o todas enfrían. Mientras las demás funcionan en el sentido contrario, esta habitación espera. Cuando la unidad exterior cambia de modo, primero se apagan las unidades que siguen en el modo anterior.`,"hero.coil_dry":`Secando ({time})`,"hero.coil_dry_drain":`Escurriendo ({time})`,"hero.coil_dry_info":`El aire acondicionado está secando su evaporador y después se apagará. Si la habitación necesita refrigeración, se detiene en el acto.`,"card.target":`Objetivo`,"card.waiting":`Esperando lecturas…`,"card.humidity":`{value} de humedad`,"card.thermostat":`Termostato`,"card.ac":`Aire acondicionado`,"card.climate_device":`dispositivo`,"card.climate_devices":`dispositivos`,"card.temp_sensor":`sensor de temperatura`,"card.temp_sensors":`sensores de temperatura`,"card.no_climate":`Ningún dispositivo para calentar o enfriar`,"card.outdoor":`Exterior`,"card.mpc_active":`MPC activo`,"card.mpc_learning":`MPC aprendiendo`,"card.compressor_min_run":`Mín. en marcha {time}`,"card.compressor_min_off":`Mín. apagado {time}`,"card.uniform_mode_heat":`Unidad exterior calentando`,"card.uniform_mode_cool":`Unidad exterior enfriando`,"card.uniform_mode_switching":`Unidad exterior cambiando de modo`,"card.not_controlled":`No controlado por RoomMind`,"mode.auto":`Automático`,"mode.auto_desc":`Calienta o enfría según cómo esté la habitación respecto a su objetivo`,"mode.auto_desc_heat":`Calienta cuando la habitación está demasiado fría. Para enfriar hace falta un aire acondicionado`,"mode.auto_desc_cool":`Enfría cuando la habitación está demasiado caliente. Aquí ningún dispositivo puede calentar`,"mode.heat_only":`Solo calor`,"mode.heat_only_desc":`Solo calienta. Junto a termostatos, el aire acondicionado solo calienta con "Elegir fuente de calor" activado`,"mode.heat_only_desc_plain":`Solo calienta, nunca enfría`,"mode.cool_only":`Solo frío`,"mode.cool_only_desc":`Solo enfría con el aire acondicionado; los termostatos se quedan apagados`,"mode.cool_only_desc_plain":`Solo enfría, nunca calienta`,"mode.unsupported":`Ningún dispositivo de esta habitación puede hacerlo. Elige otro modo.`,"mode.heating":`Calentando`,"mode.cooling":`Enfriando`,"mode.idle":`En espera`,"hero.window_open":`Ventana abierta, en pausa`,"card.window_open":`Ventana abierta`,"card.presence_away":`Fuera de casa`,"card.mold_warning":`Riesgo de moho`,"card.mold_critical":`Peligro de moho`,"card.mold_prevention":`Prevención de moho +{delta}`,"roomcard.name":`Habitación de RoomMind`,"roomcard.description":`Estado de la habitación, selección rápida de una temperatura temporal, modo y valores de confort/eco.`,"roomcard.no_area":`Elige una habitación en los ajustes de la tarjeta.`,"roomcard.loading":`Cargando…`,"roomcard.unknown_room":`Esta habitación no tiene dispositivos configurados en RoomMind.`,"roomcard.open_room":`Abrir en RoomMind`,"roomcard.mode":`Modo`,"roomcard.temperatures":`Temperaturas`,"roomcard.lower":`Bajar {name}`,"roomcard.raise":`Subir {name}`,"roomcard.error_save":`No se pudo guardar`,"roomcard.editor.area":`Habitación`,"roomcard.editor.hide_override":`Ocultar “Cambiar la temperatura temporalmente”`,"roomcard.editor.hide_mode":`Ocultar modo (automático, solo calor, solo frío)`,"roomcard.editor.hide_climate_control":`Ocultar interruptor del control de climatización`,"roomcard.editor.hide_temperatures":`Ocultar temperaturas de confort y eco`,"roomcard.paused":`en pausa`,"roomcard.editor.compact":`Diseño compacto`,"hero.price_charging":`Electricidad barata: objetivo {value} para acumular calor`,"hero.price_coasting":`Electricidad cara: objetivo {value} para ahorrar`,"hero.price_precooling":`Electricidad barata: objetivo {value} para preenfriar`,"hero.control_off":`Control de climatización desactivado`,"card.state.heating":`Calentando`,"card.state.cooling":`Enfriando`,"card.state.paused":`En pausa`,"card.state.off":`Apagado`,"card.hint.not_controlled":`Sin control`,"card.hint.override_until":`{type} hasta {time}`,"card.hint.override_permanent":`{type} · permanente`,"card.hint.override_paused":`{type} en pausa durante la ausencia`,"card.hint.vacant":`Habitación vacía`,"card.hint.price_cheap":`Electricidad barata {delta}`,"card.hint.price_expensive":`Electricidad cara {delta}`,"card.hint.preheat":`Precalentando para {temp} a partir de {time}`,"card.hint.precool":`Preenfriando para {temp} a partir de {time}`,"card.hint.setback":`Temperatura reducida, sigue encendido`,"card.hint.setback_until":`Temperatura reducida, se apaga en {time} si no hay demanda`,"hero.setback_info":`Ahora mismo la habitación no necesita calefacción ni refrigeración. Los dispositivos con la acción en reposo "Reducida" siguen encendidos en su modo con una consigna reducida, para poder retomar rápidamente. Con "Apagar tras una hora sin demanda" se apagan cuando pasa la hora si RoomMind tampoco los necesita en la hora siguiente.`,"card.control_off_global":`El control de climatización está desactivado en todas las habitaciones`,"card.control_off_room":`El control de climatización está desactivado en esta habitación`,"card.measure_only":`Solo medición, sin control`,"card.no_climate_hint":`Asigna un termostato o un aire acondicionado a esta área en Home Assistant`,"card.not_set_up":`Aún sin configurar`,"card.set_up":`Configurar`,"card.quick.schedule":`Horario`,"card.quick.normal":`Normal`,"card.quick_label":`Selección rápida para {name}`,"card.range_recent":`Últimas 6 h: {min} – {max}`,"detail.override.label":`Cambiar la temperatura temporalmente`,"detail.override.duration":`¿Durante cuánto tiempo?`,"duration.minutes":`{n} min`,"duration.hours":`{n} h`,"duration.hours_minutes":`{h} h {m} min`,"error.connection_lost":`Sin conexión con Home Assistant. Vuelve a intentarlo cuando se restablezca.`,"error.unknown":`Error desconocido`,"error.timeout":`Home Assistant no ha respondido a tiempo. Vuelve a intentarlo.`,"error.unauthorized":`Solo los administradores pueden cambiar esto.`,"error.not_found":`Esto ya no existe. Recarga la página.`,"error.invalid_format":`Un valor está fuera de su rango permitido y no se ha guardado.`,"error.no_coordinator":`RoomMind todavía se está iniciando. Vuelve a intentarlo en un momento.`,"error.no_model":`Esta habitación aún no tiene un modelo aprendido.`,"error.invalid_entity":`Las entidades propias de RoomMind no se pueden usar como dispositivo ni como sensor.`,"error.duplicate_entity":`Hay un dispositivo repetido.`,"error.duplicate_group_id":`Dos grupos tienen el mismo ID.`,"error.invalid_member":`Solo las entidades de climatización pueden ser miembros de un grupo.`,"error.duplicate_member":`Un dispositivo solo puede estar en un grupo.`,"error.invalid_master_entity":`El dispositivo principal debe ser una entidad climate, switch o input_boolean.`,"error.master_in_members":`El dispositivo principal no puede ser también miembro de su grupo.`,"error.master_is_other_member":`El dispositivo principal es miembro de otro grupo.`,"error.duplicate_master":`Un dispositivo principal solo puede pertenecer a un grupo.`,"error.invalid_action_script":`La acción debe ser una entidad de script.`,"error.schedule_no_entity":`El horario se ha creado, pero Home Assistant aún no lo muestra. Recarga la página.`,"card.hint.air_co2":`CO₂ {value} ppm, ventila la habitación`,"card.hint.air_co2_venting":`CO₂ {value} ppm, ventilación encendida`,"card.hint.air_bad":`Mala calidad del aire, ventila la habitación`,"card.hint.air_venting":`Mala calidad del aire, ventilación encendida`,"card.hint.room_fan":`Ventilador de la habitación encendido`,"card.hint.humidity_high":`Humedad {value} %, demasiado húmeda`,"card.hint.humidity_venting":`Humedad {value} %, ventilación encendida`,"card.hint.humidity_dehumidifying":`Humedad {value} %, deshumidificador encendido`,"card.hint.humidity_ac_drying":`Humedad {value} %, aire acondicionado deshumidificando`,"card.hint.humidity_outdoor_wetter":`Humedad {value} %, más húmedo fuera`,"card.hint.humidity_low":`Humedad {value} %, demasiado seca`,"card.hint.humidity_humidifying":`Humedad {value} %, humidificador encendido`}};function L(){return document.querySelector(`home-assistant`)?.hass?.language??navigator.language??`en`}function R(e,t,n){let r=(I[t]??I[t.split(`-`)[0]]??I.en)[e]??I.en[e]??e;if(n)for(let[e,t]of Object.entries(n))r=r.replaceAll(`{${e}}`,String(t));return r}var Pe={3:`error.connection_lost`,timeout:`error.timeout`,unauthorized:`error.unauthorized`,not_found:`error.not_found`,invalid_format:`error.invalid_format`,no_coordinator:`error.no_coordinator`,no_model:`error.no_model`,invalid_entity:`error.invalid_entity`,duplicate_entity:`error.duplicate_entity`,duplicate_group_id:`error.duplicate_group_id`,invalid_member:`error.invalid_member`,duplicate_member:`error.duplicate_member`,invalid_master_entity:`error.invalid_master_entity`,master_in_members:`error.master_in_members`,master_is_other_member:`error.master_is_other_member`,duplicate_master:`error.duplicate_master`,invalid_action_script:`error.invalid_action_script`,schedule_no_entity:`error.schedule_no_entity`};function Fe(e,t,n){if(e===3)return R(`error.connection_lost`,n);let r=e??{},i=r.code??r.error?.code,a=i===void 0?void 0:Pe[String(i)];if(a)return R(a,n);let o=r.message??r.error?.message;return typeof o==`string`&&o?o:t}var Ie=[`heat`,`cool`,`heat_cool`,`auto`];function Le(e,t){let n=(e,n)=>{let r=t.states[e]?.attributes?.hvac_modes;if(!Array.isArray(r))return!0;let i=r;return!i.some(e=>Ie.includes(e))||i.some(e=>n.includes(e))},r=e.filter(e=>e.type===`trv`),i=e.filter(e=>e.type===`ac`);return{heat:r.length>0||i.some(e=>n(e.entity_id,[`heat`,`heat_cool`,`auto`])),cool:i.some(e=>n(e.entity_id,[`cool`,`heat_cool`,`auto`])),mixed:r.length>0&&i.length>0}}function Re(e,t,n){return t.length===0||e===`auto`?!0:e===`heat_only`?n.heat:n.cool}var ze=0;function Be(e){typeof e==`number`&&Number.isFinite(e)&&(ze=e*1e3-Date.now())}function z(){return Date.now()+ze}function Ve(e,t,n=0,r=n){return new Intl.NumberFormat(t.language,{minimumFractionDigits:n,maximumFractionDigits:r}).format(e)}function He(e,t){return new Intl.NumberFormat(t.language,{style:`percent`,maximumFractionDigits:0}).format(e/100)}var Ue=`\xA0`;function B(e,t,n=0){return new Intl.NumberFormat(t,{maximumFractionDigits:n}).format(e)}function We(e){return e.replace(/ /g,Ue)}function V(e,t){let n=Math.max(0,Math.round(e)),r=Math.floor(n/60),i=n%60;return We(r===0?R(`duration.minutes`,t,{n:B(i,t)}):i===0?R(`duration.hours`,t,{n:B(r,t)}):R(`duration.hours_minutes`,t,{h:B(r,t),m:B(i,t)}))}function Ge(e,t){return e>0&&e<1?V(e*60,t):We(R(`duration.hours`,t,{n:B(e,t,1)}))}function Ke(e,t,n=z()/1e3){let r=e-n;return r>0?V(Math.ceil(r/60),t):``}function qe(e){switch(e){case`heating`:return`mode-heating`;case`cooling`:return`mode-cooling`;case`idle`:return`mode-idle`;default:return`mode-other`}}function Je(e){return e==null?1:Math.max(1,Math.ceil((e*1e3-z())/6e4))}function Ye(e){return(e?.devices?.length??0)>0||(e?.thermostats?.length??0)>0||(e?.acs?.length??0)>0||!!e?.humidifier_entity||!!e?.dehumidifier_entity}function Xe(e,t){let n=e?.live,r=!!n&&(n.current_temp!==null||n.current_humidity!==null);return e?.is_outdoor?r?`outdoor`:t>0?`unconfigured`:`empty`:e&&Ye(e)?n?`controlled`:`waiting`:r?`sensor`:t>0?`unconfigured`:`empty`}function Ze(e,t){return t&&e?.climate_control_enabled!==!1}function Qe(e,t){let n=e.live;if(!Ze(e,t))return{key:`card.state.off`,icon:`mdi:power-off`,tone:`off`,power:null};if(n?.window_open)return{key:`card.state.paused`,icon:`mdi:pause-circle-outline`,tone:`paused`,power:null};let r=n?.heating_power??0,i=r>0&&r<100?Math.round(r):null;return n?.mode===`heating`?{key:`card.state.heating`,icon:`mdi:fire`,tone:`heat`,power:i}:n?.mode===`cooling`?{key:`card.state.cooling`,icon:`mdi:snowflake`,tone:`cool`,power:i}:{key:`mode.idle`,icon:`mdi:circle-small`,tone:`idle`,power:null}}function $e(e,t){if(!e.setback?.devices.length||e.mode!==`idle`)return null;let n=e.setback.until;return{id:`setback`,icon:`mdi:thermometer-chevron-down`,severity:`info`,...n!=null&&n*1e3>z()?{key:`card.hint.setback_until`,params:{time:V(Je(n),t)}}:{key:`card.hint.setback`}}}function et(e,t){return R(e.key,t,e.params)}function tt(e,t){let n=nt(e),r=n?t?.[n]?.attributes?.next_event:void 0;if(typeof r!=`string`)return null;let i=Date.parse(r);return Number.isFinite(i)?i/1e3:null}function nt(e){let t=(e?.schedules??[]).filter(e=>!!e.entity_id);return t.length?(t[e?.live?.active_schedule_index??-1]??t[0]).entity_id:null}var rt=o`
  .mode-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 500;
    padding: 4px 14px;
    border-radius: 16px;
  }

  .mode-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .mode-heating {
    color: var(--rs-heat-text);
    background: color-mix(in srgb, var(--rs-heat) 12%, transparent);
  }
  .mode-heating .mode-dot {
    background: var(--rs-heat);
  }

  .mode-cooling {
    color: var(--rs-cool-text);
    background: color-mix(in srgb, var(--rs-cool) 12%, transparent);
  }
  .mode-cooling .mode-dot {
    background: var(--rs-cool);
  }

  .mode-idle {
    color: var(--secondary-text-color, #757575);
    background: color-mix(in srgb, var(--secondary-text-color) 5%, transparent);
  }
  .mode-idle .mode-dot {
    background: var(--disabled-text-color, #bdbdbd);
  }

  .mode-other {
    color: var(--secondary-text-color);
    background: color-mix(in srgb, var(--secondary-text-color) 5%, transparent);
  }
  .mode-other .mode-dot {
    background: var(--secondary-text-color);
  }
`,it=o`
  :host {
    --rs-radius: var(--ha-card-border-radius, 12px);
    --rs-radius-sm: 8px;
    --rs-fill: color-mix(in srgb, var(--secondary-text-color) 8%, transparent);
    --rs-fill-strong: color-mix(in srgb, var(--secondary-text-color) 14%, transparent);
    --rs-fill-primary: color-mix(in srgb, var(--primary-color) 10%, transparent);
    --rs-heat: var(--state-climate-heat-color, var(--warning-color));
    --rs-cool: var(--state-climate-cool-color, var(--info-color));
    --rs-humidify: #00acc1;
    --rs-dehumidify: #9c27b0;
    --rs-ok: var(--success-color);
    --rs-warn: var(--warning-color);
    --rs-err: var(--error-color);
    /* Status colours as text: half mixed with the text colour reaches 4.5:1 on their own
       12-16 % tint in HA's light and dark theme (orange alone: 1.8:1). Icons keep the plain colour. */
    --rs-heat-text: color-mix(in srgb, var(--rs-heat) 50%, var(--primary-text-color));
    --rs-cool-text: color-mix(in srgb, var(--rs-cool) 50%, var(--primary-text-color));
    --rs-humidify-text: color-mix(in srgb, var(--rs-humidify) 60%, var(--primary-text-color));
    --rs-dehumidify-text: color-mix(in srgb, var(--rs-dehumidify) 55%, var(--primary-text-color));
    --rs-ok-text: color-mix(in srgb, var(--rs-ok) 50%, var(--primary-text-color));
    --rs-warn-text: color-mix(in srgb, var(--rs-warn) 50%, var(--primary-text-color));
    --rs-err-text: color-mix(in srgb, var(--rs-err) 50%, var(--primary-text-color));
    --rs-border: var(--divider-color);
    --rs-border-strong: color-mix(in srgb, var(--primary-text-color) 22%, transparent);
    --rs-surface: var(--card-background-color, var(--ha-card-background));
    --rs-shadow-pop: 0 1px 3px rgb(0 0 0 / 12%), 0 8px 24px rgb(0 0 0 / 22%);
    --rs-shadow-lift: 0 2px 6px rgb(0 0 0 / 14%), 0 14px 36px rgb(0 0 0 / 25%);
    --rs-space-1: 4px;
    --rs-space-2: 8px;
    --rs-space-3: 12px;
    --rs-space-4: 16px;
    --rs-space-5: 20px;
    --rs-space-6: 24px;
    --rs-font-xs: 11px;
    --rs-font-sm: 12px;
    --rs-font-md: 14px;
    --rs-font-lg: 16px;
    --rs-font-xl: 20px;
    --rs-font-display: 48px;
    --rs-touch: 44px;
  }
`;o`
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
`,o`
  .rs-alert {
    margin: 0 0 var(--rs-space-4);
    padding: var(--rs-space-2) var(--rs-space-3);
    border-radius: var(--rs-radius-sm);
    background: color-mix(in srgb, var(--rs-err) 12%, transparent);
    color: var(--rs-err-text);
    font-size: var(--rs-font-md);
    line-height: 1.4;
  }
`;function H(e){return e.config?.unit_system?.temperature===`°F`}function at(e){return H(e)?`°F`:`°C`}function ot(e,t){return H(t)?e*9/5+32:e}function st(e,t){return H(t)?(e-32)*5/9:e}function U(e,t,n=1,r=n){return Ve(ot(e,t),t,n,r)}var ct=[1,2,4];function lt(e,t,n,r){let i,a;return e===`boost`?(i=n.comfortHeat,a=n.comfortCool):e===`eco`?(i=n.ecoHeat,a=n.ecoCool):(i=r.heat,a=r.cool),t===`heat_only`&&(a=null),t===`cool_only`&&(i=null),{heat:i,cool:a}}function ut(e,t){return e!=null&&t!=null&&t<e}function dt(e,t,n,r,i,a=!1){let o={type:`roommind/override/set`,area_id:e,override_type:t,duration:n};return a&&(o.until_schedule_change=!0),t===`custom`&&(r!==`cool_only`&&(o.heat=i.heat),r!==`heat_only`&&(o.cool=i.cool)),o}function ft(e,t){let n=(e?.schedules??[]).some(e=>!!e.entity_id);return[{value:`schedule`,label:R(n?`card.quick.schedule`:`card.quick.normal`,t),icon:n?`mdi:calendar-clock`:`mdi:home-thermometer-outline`},{value:`comfort`,label:R(`override.comfort`,t),icon:`mdi:sofa`},{value:`eco`,label:R(`override.eco`,t),icon:`mdi:leaf`}]}function pt(e,t){return t===`schedule`?{type:`roommind/override/clear`,area_id:e.area_id}:dt(e.area_id,t===`comfort`?`boost`:`eco`,6,e.climate_mode??`auto`,{heat:0,cool:0},!0)}var mt=1e4,W=new Set,G=null,K,q=null,J=null,Y=``;function ht(e){let t=!G;G=e,t&&W.size&&X()}function gt(e){return W.add(e),(J||Y)&&e(J,Y),W.size===1&&vt(),()=>{W.delete(e),W.size||yt()}}function X(e=!1){return G?q?e?q.then(()=>X(!0)):q:(q=G.callWS({type:`roommind/rooms/list`}).then(e=>{Be(e.server_time),J={rooms:e.rooms??{},climate_control_active:e.climate_control_active??!0},Y=``}).catch(e=>{Y=e instanceof Error?e.message:String(e?.message??e)}).finally(()=>{q=null;for(let e of W)e(J,Y)}),q):Promise.resolve()}function _t(){document.hidden||X()}function vt(){X(),K=setInterval(()=>{document.hidden||X()},mt),document.addEventListener(`visibilitychange`,_t)}function yt(){K&&clearInterval(K),K=void 0,document.removeEventListener(`visibilitychange`,_t)}function Z(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a}var bt=800,xt={boost:`override.comfort`,eco:`override.eco`,custom:`override.custom`},St={boost:`comfort`,eco:`eco`,custom:`custom`},Ct=[{value:`auto`,icon:`mdi:autorenew`,key:`mode.auto`},{value:`heat_only`,icon:`mdi:fire`,key:`mode.heat_only`},{value:`cool_only`,icon:`mdi:snowflake`,key:`mode.cool_only`}],Q=class extends P{constructor(...e){super(...e),this._feed=null,this._feedError=``,this._now=z()/1e3,this._pending=null,this._customHeat=21,this._customCool=24,this._optimisticOverride=null,this._modeDraft=null,this._controlDraft=null,this._tempsDraft=null,this._error=``,this._tempsEdit=0}static getConfigForm(){return{schema:[{name:`area`,required:!0,selector:{area:{}}},{name:`compact`,selector:{boolean:{}}},{name:`hide_override`,selector:{boolean:{}}},{name:`hide_mode`,selector:{boolean:{}}},{name:`hide_climate_control`,selector:{boolean:{}}},{name:`hide_temperatures`,selector:{boolean:{}}}],computeLabel:e=>R(`roomcard.editor.${e.name}`,L())}}static getStubConfig(e){return{type:`custom:roommind-room-card`,area:Object.values(e?.entities??{}).find(e=>e.platform===`roommind`&&e.entity_id.startsWith(`climate.`)&&e.area_id)?.area_id??Object.keys(e?.areas??{})[0]??``}}setConfig(e){if(!e)throw Error(`Invalid configuration`);e.area!==this._config?.area&&(this._flushTemps(),this._resetDrafts()),this._config=e}getCardSize(){let e=this._config;return e?.compact?2+(this._shown(e.hide_override)||this._shown(e.hide_mode)||this._shown(e.hide_climate_control)?1:0)+(this._shown(e.hide_temperatures)?2:0):3+(this._shown(e?.hide_override)?2:0)+(this._shown(e?.hide_mode)?2:+!!this._shown(e?.hide_climate_control))+(this._shown(e?.hide_temperatures)?3:0)}getGridOptions(){return this._config?.compact?{columns:6,min_columns:6}:{columns:12,min_columns:9}}connectedCallback(){super.connectedCallback(),this.hass&&ht(this.hass),this._unsubscribe=gt((e,t)=>{this._feed=e,this._feedError=t}),this._clock=setInterval(()=>this._now=z()/1e3,3e4)}disconnectedCallback(){super.disconnectedCallback(),this._unsubscribe?.(),this._unsubscribe=void 0,this._clock&&clearInterval(this._clock),this._clock=void 0,this._flushTemps()}willUpdate(e){e.has(`hass`)&&this.hass&&ht(this.hass)}_compactTitle(e){return this._config?.compact?e:D}_shown(e){return e!==!0}get _lang(){return this.hass?.language??`en`}get _room(){let e=this._config?.area;return e?this._feed?.rooms[e]:void 0}_climateMode(e){return this._modeDraft??e.climate_mode??`auto`}_temps(e){return this._tempsDraft??{comfortHeat:e.comfort_heat??e.comfort_temp??21,comfortCool:e.comfort_cool??24,ecoHeat:e.eco_heat??e.eco_temp??17,ecoCool:e.eco_cool??27}}_override(e){if(this._optimisticOverride)return this._optimisticOverride;let t=e.live;return t?.override_active&&t.override_type?{type:t.override_type,until:t.override_until}:{type:null,until:null}}_resetDrafts(){this._pending=null,this._optimisticOverride=null,this._modeDraft=null,this._controlDraft=null,this._tempsDraft=null,this._error=``}render(){if(!this._config||!this.hass)return D;if(!this._config.area)return this._renderMessage(R(`roomcard.no_area`,this._lang));if(!this._feed)return this._renderMessage(this._feedError||R(`roomcard.loading`,this._lang),this._feedError?`error`:``);let e=this._room,t=e?Xe(e,0):`empty`;if(e&&(t===`outdoor`||t===`sensor`))return this._renderMonitorOnly(e);if(!e||(e.devices?.length??0)===0)return this._renderMessage(R(`roomcard.unknown_room`,this._lang),``,!0);let n=e.live,r=n?.mode,i=(this._controlDraft??e.climate_control_enabled!==!1)&&this._feed.climate_control_active;return T`
      <ha-card class=${this._config.compact?`compact`:``}>
        <div class="accent ${r?qe(r):`mode-other`}"></div>
        <div class="content">
          ${this._renderHeader(e)}
          ${n?this._renderStatus(e,i):T` <div class="hint">${R(`card.waiting`,this._lang)}</div> `}
          <div class="controls">
            ${this._shown(this._config.hide_override)?this._renderOverride(e):D}
            ${this._renderMode(e)}
          </div>
          ${this._shown(this._config.hide_temperatures)?this._renderTemps(e):D}
          <div class="error" role="status" aria-live="polite">${this._error}</div>
        </div>
      </ha-card>
    `}_renderMonitorOnly(e){let t=e.live,n=this._lang;return T`
      <ha-card class=${this._config?.compact?`compact`:``}>
        <div class="content">
          <div class="header">
            ${this._renderName(e.area_id,e)}
            <span class="mode-pill mode-other"
              >${R(e.is_outdoor?`card.outdoor`:`card.measure_only`,n)}</span
            >
          </div>
          <div class="temps">
            <span class="current">
              ${t?.current_temp==null?`--`:U(t.current_temp,this.hass)}<span
                class="unit"
                >${at(this.hass)}</span
              >
            </span>
            ${t?.current_humidity==null?D:T`<div class="target-block">
                    ${R(`card.humidity`,n,{value:He(t.current_humidity,{language:n})})}
                  </div>`}
          </div>
        </div>
      </ha-card>
    `}_renderMessage(e,t=``,n=!1){return T`
      <ha-card class=${this._config?.compact?`compact`:``}>
        <div class="content">
          ${this._config?.area?T`<div class="header">${this._renderName(this._config.area,void 0)}</div>`:D}
          <div class="hint ${t}">${e}</div>
          ${n&&this._canOpenPanel()?T`<a class="open-link" href=${this._roomPath()} @click=${this._openRoom}
                  >${R(`roomcard.open_room`,this._lang)}</a
                >`:D}
        </div>
      </ha-card>
    `}_canOpenPanel(){return this.hass.user?.is_admin===!0}_roomPath(){return`/roommind/room/${encodeURIComponent(this._config?.area??``)}`}_renderName(e,t){let n=t?.display_name||this.hass.areas?.[e]?.name||e;return this._canOpenPanel()?T`<a class="name" href=${this._roomPath()} @click=${this._openRoom}>${n}</a>`:T`<span class="name">${n}</span>`}_renderHeader(e){let t=e.live?Qe({...e,climate_control_enabled:this._controlDraft??e.climate_control_enabled},this._feed?.climate_control_active??!0):null,n=t?.tone===`heat`?`mode-heating`:t?.tone===`cool`?`mode-cooling`:`mode-idle`;return T`
      <div class="header">
        ${this._renderName(e.area_id,e)}
        ${t?T`<span class="mode-pill ${n}">
                <span class="mode-dot"></span>
                ${R(t.key,this._lang)}${t.power==null?``:` · ${He(t.power,{language:this._lang})}`}
              </span>`:D}
      </div>
    `}_renderStatus(e,t){let n=e.live,r=this._lang,i=this._override(e),a=this._climateMode(e)===`auto`&&n.heat_target!=null&&n.cool_target!=null&&n.heat_target!==n.cool_target,o=n.target_temp??n.heat_target??n.cool_target,s=at(this.hass),c=e=>U(e,this.hass,0,1),l=!this._optimisticOverride&&!!n.override_suppressed,u=$e(n,r),d=``;return l?d=R(`roomcard.paused`,r):i.type&&(d=i.until?R(`hero.remaining`,r,{time:Ke(i.until,r,this._now)||V(0,r)}):R(`hero.permanent`,r)),T`
      <div class="temps">
        <span class="current">
          ${n.current_temp==null?`--`:U(n.current_temp,this.hass)}<span
            class="unit"
            >${s}</span
          >
        </span>
        <div class="target-block">
          ${o!=null||a?T`<span class="target">
                  ${R(`card.target`,r)}
                  <strong
                    >${a?`${c(n.heat_target)}–${c(n.cool_target)}`:c(o)}
                    ${s}</strong
                  >
                </span>`:D}
          <span class="icons">
            ${n.window_open?T`<ha-icon
                    icon="mdi:window-open-variant"
                    role="img"
                    title=${R(`card.window_open`,r)}
                    aria-label=${R(`card.window_open`,r)}
                  ></ha-icon>`:D}
            ${n.presence_away?T`<ha-icon
                    icon="mdi:home-off-outline"
                    role="img"
                    title=${R(`card.presence_away`,r)}
                    aria-label=${R(`card.presence_away`,r)}
                  ></ha-icon>`:D}
            ${u?T`<ha-icon
                    icon=${u.icon}
                    role="img"
                    title=${et(u,r)}
                    aria-label=${et(u,r)}
                  ></ha-icon>`:D}
            ${n.current_humidity==null?D:T`<span
                    class="humidity ${n.humidity_action===`humidifying`?`humidifying`:n.humidity_action===`dehumidifying`?`dehumidifying`:``}"
                  >
                    ${n.humidity_action===`humidifying`?T`<ha-icon icon="mdi:water-plus" aria-hidden="true"></ha-icon>`:n.humidity_action===`dehumidifying`?T`<ha-icon icon="mdi:water-minus" aria-hidden="true"></ha-icon>`:D}
                    ${R(`card.humidity`,r,{value:He(n.current_humidity,{language:r})})}${n.humidity_action===`humidifying`&&n.humidify_target!=null?` → ${Math.round(n.humidify_target)}%`:n.humidity_action===`dehumidifying`&&n.dehumidify_target!=null?` → ${Math.round(n.dehumidify_target)}%`:``}
                  </span>`}
            ${n.pm25==null?n.pm10==null?D:T`<span class="pm ${n.air_quality_bad?`pm-alert`:``}"
                      >PM10 ${Math.round(n.pm10)} µg/m³</span
                    >`:T`<span class="pm ${n.air_quality_bad?`pm-alert`:``}"
                    >PM2.5 ${Math.round(n.pm25)} µg/m³</span
                  >`}
          </span>
        </div>
      </div>
      ${i.type?T`<div class="override-status ${l?`paused`:i.type}">
              <ha-icon
                icon=${l?`mdi:pause-circle-outline`:`mdi:timer-outline`}
                aria-hidden="true"
              ></ha-icon>
              <span>${R(xt[i.type],r)} · ${d}</span>
            </div>`:D}
      ${t?D:T`<div class="hint">
              ${R(this._feed?.climate_control_active===!1?`card.control_off_global`:`card.control_off_room`,r)}
            </div>`}
    `}_renderOverride(e){let t=this._lang,n=this._override(e).type,r=this._climateMode(e),i=this._pending?`custom`:n?St[n]:`schedule`,a=[...ft(e,t),{value:`custom`,label:R(`override.custom`,t),icon:`mdi:thermometer`}];return T`
      <section class="override-section ${this._pending?`expanded`:``}">
        <h4 id="ov-label">${R(`detail.override.label`,t)}</h4>
        <div class="segments" role="group" aria-labelledby="ov-label">
          ${a.map(t=>T`
              <button
                class="segment ${t.value} ${i===t.value?`active`:``}"
                aria-pressed=${i===t.value}
                title=${this._compactTitle(t.label)}
                @click=${()=>this._onQuickChoice(e,t.value)}
              >
                <ha-icon icon=${t.icon} aria-hidden="true"></ha-icon>
                <span>${t.label}</span>
              </button>
            `)}
        </div>
        ${this._pending?T`
                <div class="custom-row">
                  ${r===`cool_only`?D:this._customField(r===`auto`?`override.heat_to`:`override.target`,this._customHeat,e=>{this._customHeat=e,r===`auto`&&this._customCool<e&&(this._customCool=e)})}
                  ${r===`heat_only`?D:this._customField(r===`auto`?`override.cool_above`:`override.target`,this._customCool,e=>{this._customCool=e,r===`auto`&&this._customHeat>e&&(this._customHeat=e)})}
                </div>
                <div class="duration">
                  <span>${R(`detail.override.duration`,t)}</span>
                  ${ct.map(n=>T`<button class="chip" @click=${()=>this._activate(e,n)}>
                        ${Ge(n,t)}
                      </button>`)}
                </div>
              `:D}
      </section>
    `}_renderMode(e){let t=this._shown(this._config?.hide_mode),n=this._shown(this._config?.hide_climate_control);if(!t&&!n)return D;let r=this._lang,i=this._climateMode(e),a=this._controlDraft??e.climate_control_enabled!==!1,o=T`<div class="section-head">
      ${t?T`<h4>${R(`roomcard.mode`,r)}</h4>`:T`<span></span>`}
      ${n?T`<button
              class="switch"
              role="switch"
              aria-checked=${a?`true`:`false`}
              aria-label=${R(`room.climate_control_toggle`,r)}
              title=${this._compactTitle(R(`room.climate_control_toggle`,r))}
              @click=${()=>this._saveRoom({climate_control_enabled:!a},`control`)}
            >
              <ha-icon class="switch-icon" icon="mdi:power" aria-hidden="true"></ha-icon>
              <span class="switch-label">${R(`room.climate_control_toggle`,r)}</span>
              <span class="track"><span class="thumb"></span></span>
            </button>`:D}
    </div>`,s=e.devices??[],c=Le(s,this.hass),l=Ct.filter(e=>e.value===i||Re(e.value,s,c)),u=t?T`<div class="segments">
          ${l.map(e=>T`
              <button
                class="segment ${i===e.value?`active`:``}"
                aria-pressed=${i===e.value}
                aria-label=${R(e.key,r)}
                title=${this._compactTitle(R(e.key,r))}
                @click=${()=>i!==e.value&&this._saveRoom({climate_mode:e.value},`mode`)}
              >
                <ha-icon icon=${e.icon}></ha-icon>
                <span>${R(e.key,r)}</span>
              </button>
            `)}
        </div>`:D;return T`
      <section class="mode-section">
        ${this._config?.compact?T`${u}${o}`:T`${o}${u}`}
      </section>
    `}_renderTemps(e){let t=this._lang,n=this._climateMode(e),r=this._temps(e),i=n===`auto`,a=R(`mode.heating`,t),o=R(`mode.cooling`,t),s=(s,c,l)=>{let u=R(s,t);return T`
        <span class="row-label">${u}</span>
        ${n===`cool_only`?D:this._stepper(i?`${u} ${a}`:u,r[c],t=>this._editTemps(e,c,t),i?`mdi:fire`:void 0)}
        ${n===`heat_only`?D:this._stepper(i?`${u} ${o}`:u,r[l],t=>this._editTemps(e,l,t),i?`mdi:snowflake`:void 0)}
      `};return T`
      <section class="temps-section">
        <h4>${R(`roomcard.temperatures`,t)}</h4>
        <div class="temp-grid ${i?`auto`:`single`}">
          ${i?T`
                  <span class="corner"></span>
                  <span class="col-head"><ha-icon icon="mdi:fire"></ha-icon>${a}</span>
                  <span class="col-head"><ha-icon icon="mdi:snowflake"></ha-icon>${o}</span>
                `:D}
          ${s(`override.comfort`,`comfortHeat`,`comfortCool`)}
          ${s(`override.eco`,`ecoHeat`,`ecoCool`)}
        </div>
      </section>
    `}_customField(e,t,n){let r=R(e,this._lang).replace(/:\s*$/,``);return T`
      <div class="custom-field">
        <span class="field-label">${r}</span>
        ${this._stepper(r,t,n)}
      </div>
    `}_stepper(e,t,n,r){let i=this._lang;return T`
      <div class="stepper" role="group" aria-label=${e}>
        <button
          class="step"
          aria-label=${R(`roomcard.lower`,i,{name:e})}
          aria-disabled=${t<=5?`true`:`false`}
          @click=${()=>t>5&&n(this._step(t,-1))}
        >
          <ha-icon icon="mdi:minus"></ha-icon>
        </button>
        <span class="value" aria-live="polite"
          >${r?T`<ha-icon class="side-icon" icon=${r} aria-hidden="true"></ha-icon>`:D}${U(t,this.hass,0,1)}
          ${at(this.hass)}</span
        >
        <button
          class="step"
          aria-label=${R(`roomcard.raise`,i,{name:e})}
          aria-disabled=${t>=35?`true`:`false`}
          @click=${()=>t<35&&n(this._step(t,1))}
        >
          <ha-icon icon="mdi:plus"></ha-icon>
        </button>
      </div>
    `}_step(e,t){let n=H(this.hass)?1:.5,r=ot(e,this.hass)/n,i=st((t>0?Math.floor(r+1e-6)+1:Math.ceil(r-1e-6)-1)*n,this.hass);return Math.min(35,Math.max(5,i))}_openRoom(e){e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||(e.preventDefault(),history.pushState(null,``,this._roomPath()),window.dispatchEvent(new CustomEvent(`location-changed`,{detail:{replace:!1}})))}_onQuickChoice(e,t){if(this._error=``,t===`custom`){if(this._pending){this._pending=null;return}this._pending=`custom`;let t=e.live,n=this._temps(e);this._customHeat=t?.override_type===`custom`&&t.override_heat!=null?t.override_heat:n.comfortHeat,this._customCool=t?.override_type===`custom`&&t.override_cool!=null?t.override_cool:n.comfortCool}else this._pending=null,this._quick(e,t)}async _quick(e,t){let n=z()/1e3,r=tt(e,this.hass.states);this._optimisticOverride=t===`schedule`?{type:null,until:null}:{type:t===`comfort`?`boost`:`eco`,until:r!=null&&r>n?r:n+21600};try{this._tempsTimer&&(clearTimeout(this._tempsTimer),await this._saveTemps()),await this.hass.callWS(pt(e,t)),await X(!0)}catch(e){this._error=this._message(e,t===`schedule`?`override.error_clear`:`override.error_set`)}this._optimisticOverride=null}async _activate(e,t){let n=this._pending;if(!n)return;let r=this._climateMode(e),i={heat:this._customHeat,cool:this._customCool},a=lt(n,r,this._temps(e),i);if(ut(a.heat,a.cool))this._error=R(`override.invalid_band`,this._lang);else{this._pending=null,this._error=``,this._optimisticOverride={type:n,until:z()/1e3+t*3600},this._refocusPreset(n);try{this._tempsTimer&&(clearTimeout(this._tempsTimer),await this._saveTemps()),await this.hass.callWS(dt(e.area_id,n,t,r,i)),await X(!0)}catch(e){this._error=this._message(e,`override.error_set`)}this._optimisticOverride=null}}async _refocusPreset(e){let t=this.shadowRoot,n=!!t?.activeElement;await this.updateComplete,n&&!t?.activeElement&&t?.querySelector(`.override-section .segment.${St[e]}`)?.focus()}async _saveRoom(e,t){if(this._config?.area){this._error=``,t===`mode`?this._modeDraft=e.climate_mode:this._controlDraft=e.climate_control_enabled;try{await this.hass.callWS({type:`roommind/rooms/save`,area_id:this._config.area,...e}),await X(!0)}catch(e){this._error=this._message(e,`roomcard.error_save`)}t===`mode`?this._modeDraft=null:this._controlDraft=null}}_editTemps(e,t,n){let r={...this._temps(e),[t]:n};t===`comfortHeat`&&r.comfortCool<n&&(r.comfortCool=n),t===`comfortCool`&&r.comfortHeat>n&&(r.comfortHeat=n),t===`ecoHeat`&&r.ecoCool<n&&(r.ecoCool=n),t===`ecoCool`&&r.ecoHeat>n&&(r.ecoHeat=n),this._tempsDraft=r,this._tempsEdit+=1,this._tempsTimer&&clearTimeout(this._tempsTimer),this._tempsTimer=setTimeout(()=>void this._saveTemps(),bt)}_flushTemps(){this._tempsTimer&&(clearTimeout(this._tempsTimer),this._saveTemps())}async _saveTemps(){this._tempsTimer=void 0;let e=this._tempsDraft,t=this._config?.area;if(!e||!t)return;let n=this._tempsEdit;try{await this.hass.callWS({type:`roommind/rooms/save`,area_id:t,comfort_heat:e.comfortHeat,comfort_cool:e.comfortCool,eco_heat:e.ecoHeat,eco_cool:e.ecoCool}),await X(!0)}catch(e){this._error=this._message(e,`roomcard.error_save`)}n===this._tempsEdit&&(this._tempsDraft=null)}_message(e,t){return Fe(e,R(t,this._lang),this._lang)}static{this.styles=[it,rt,o`
      :host {
        display: block;
      }

      ha-card {
        position: relative;
        overflow: hidden;
        height: 100%;
        box-sizing: border-box;
        container-type: inline-size;
      }

      .accent {
        position: absolute;
        inset: 0 auto 0 0;
        width: 4px;
      }

      .accent.mode-heating {
        background: var(--rs-heat);
      }

      .accent.mode-cooling {
        background: var(--rs-cool);
      }

      .accent.mode-idle,
      .accent.mode-other {
        background: var(--disabled-text-color, #bdbdbd);
      }

      .content {
        padding: 16px 16px 12px 20px;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }

      .name {
        font-size: 16px;
        font-weight: 500;
        color: var(--primary-text-color);
        text-decoration: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
        min-height: 44px;
        line-height: 44px;
      }

      a.name:hover {
        text-decoration: underline;
      }

      .mode-pill {
        flex-shrink: 0;
        gap: 5px;
        font-size: 12px;
        padding: 3px 10px;
        border-radius: 12px;
      }

      .mode-dot {
        width: 7px;
        height: 7px;
      }

      .temps {
        display: flex;
        align-items: flex-end;
        gap: 12px;
        flex-wrap: wrap;
      }

      .current {
        font-size: 40px;
        font-weight: 300;
        line-height: 1;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .unit {
        font-size: 18px;
        color: var(--secondary-text-color);
        margin-left: 2px;
      }

      .target-block {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 13px;
        color: var(--secondary-text-color);
        padding-bottom: 3px;
      }

      .target strong {
        font-weight: 500;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .icons {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }

      .icons ha-icon {
        --mdc-icon-size: 16px;
      }

      .humidity {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }

      .humidity.humidifying {
        color: var(--rs-humidify-text);
        font-weight: 500;
      }

      .humidity.dehumidifying {
        color: var(--rs-dehumidify-text);
        font-weight: 500;
      }

      .pm {
        font-size: 12px;
        color: var(--secondary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .pm.pm-alert {
        color: var(--rs-warn-text);
        font-weight: 500;
      }

      .override-status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 12px;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 13px;
        font-variant-numeric: tabular-nums;
      }

      .override-status ha-icon {
        --mdc-icon-size: 16px;
      }

      .override-status.paused {
        color: var(--secondary-text-color);
        background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
      }

      .override-status.boost {
        color: var(--rs-warn-text);
        background: color-mix(in srgb, var(--rs-warn) 12%, transparent);
      }

      .override-status.eco {
        color: var(--rs-ok-text);
        background: color-mix(in srgb, var(--rs-ok) 12%, transparent);
      }

      .override-status.custom {
        color: var(--rs-cool-text);
        background: color-mix(in srgb, var(--rs-cool) 12%, transparent);
      }

      .hint {
        margin-top: 10px;
        font-size: 13px;
        color: var(--secondary-text-color);
      }

      .hint.error,
      .error {
        color: var(--rs-err-text);
        font-size: 13px;
      }

      .error:not(:empty) {
        margin-top: 10px;
      }

      .open-link {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        color: var(--primary-color);
        font-size: 14px;
      }

      section {
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }

      h4 {
        margin: 0 0 8px;
        font-size: 13px;
        font-weight: 500;
        color: var(--secondary-text-color);
      }

      .section-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }

      .section-head h4 {
        margin: 0;
      }

      button {
        font: inherit;
        color: inherit;
        touch-action: manipulation;
      }

      button:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }

      /* one row, as many equal columns as options (quick choice has 3 or 4) */
      .segments {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 1fr);
        gap: 8px;
      }

      .segment {
        min-height: 56px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 6px 4px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 10px;
        background: transparent;
        color: var(--primary-text-color);
        font-size: 12px;
        line-height: 1.2;
        text-align: center;
        cursor: pointer;
        min-width: 0;
        overflow-wrap: break-word;
        hyphens: auto;
        transition:
          background-color 0.15s,
          border-color 0.15s;
      }

      .segment ha-icon {
        --mdc-icon-size: 18px;
        flex-shrink: 0;
      }

      .segment:hover:not(:disabled) {
        background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.04);
      }

      .segment:disabled {
        opacity: 0.4;
        cursor: default;
      }

      /* one selected look for every option, like the panel's segmented controls */
      .segment.active {
        border-color: var(--primary-color);
        background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.1);
        color: var(--primary-color);
      }

      .custom-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 8px 12px;
        margin-top: 10px;
      }

      .custom-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .field-label {
        font-size: 12px;
        color: var(--secondary-text-color);
      }

      .duration {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
        font-size: 13px;
        color: var(--secondary-text-color);
      }

      .chip {
        min-width: 56px;
        min-height: 44px;
        border-radius: 22px;
        border: 1px solid var(--primary-color);
        background: transparent;
        color: var(--primary-color);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
      }

      .chip:hover {
        background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.1);
      }

      .switch {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        padding: 0;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 13px;
        color: var(--secondary-text-color);
      }

      .track {
        position: relative;
        width: 36px;
        height: 20px;
        border-radius: 10px;
        background: var(--disabled-text-color, #bdbdbd);
        transition: background-color 0.15s;
        flex-shrink: 0;
      }

      .thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--card-background-color, #fff);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        transition: transform 0.15s;
      }

      .switch[aria-checked="true"] .track {
        background: var(--primary-color);
      }

      .switch[aria-checked="true"] .thumb {
        transform: translateX(16px);
      }

      .temp-grid {
        display: grid;
        align-items: center;
        gap: 8px 12px;
      }

      .temp-grid.single {
        grid-template-columns: 1fr auto;
      }

      .temp-grid.auto {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }

      .temp-grid.auto .corner {
        display: none;
      }

      .temp-grid.auto .row-label {
        grid-column: 1 / -1;
        margin-bottom: -4px;
      }

      @container (max-width: 339px) {
        .temp-grid.auto {
          grid-template-columns: minmax(0, 1fr);
        }

        .temp-grid.auto .col-head {
          display: none;
        }

        .temp-grid.auto .side-icon {
          display: inline-block;
        }
      }

      @container (max-width: 259px) {
        .temp-grid.single {
          grid-template-columns: minmax(0, 1fr);
        }
      }

      .col-head {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--secondary-text-color);
      }

      .col-head ha-icon {
        --mdc-icon-size: 14px;
      }

      @container (min-width: 440px) {
        .temp-grid.auto {
          grid-template-columns: auto 1fr 1fr;
        }

        .temp-grid.auto .corner {
          display: block;
        }

        .temp-grid.auto .row-label {
          grid-column: auto;
          margin-bottom: 0;
        }
      }

      .row-label {
        font-size: 14px;
        color: var(--primary-text-color);
      }

      .stepper {
        min-width: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 22px;
      }

      .step {
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--primary-text-color);
        cursor: pointer;
      }

      .step ha-icon {
        --mdc-icon-size: 18px;
      }

      .step:hover:not([aria-disabled="true"]) {
        background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
      }

      .step[aria-disabled="true"] {
        opacity: 0.35;
        cursor: default;
      }

      .side-icon {
        display: none;
        --mdc-icon-size: 14px;
        margin-right: 2px;
        color: var(--secondary-text-color);
      }

      .value {
        flex: 1;
        min-width: 48px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
        text-align: center;
        font-size: 15px;
        font-variant-numeric: tabular-nums;
        color: var(--primary-text-color);
      }

      .switch-icon {
        display: none;
        --mdc-icon-size: 18px;
      }

      /* Compact: one status block, icon-only controls side by side. */
      .compact .content {
        padding: 10px 12px 8px 16px;
      }

      .compact .name {
        font-size: 15px;
        line-height: 1.25;
        white-space: normal;
        overflow-wrap: break-word;
        flex-shrink: 0;
        max-width: 100%;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        padding: 13px 0;
        min-height: 0;
      }

      .compact .header {
        flex-wrap: wrap;
        row-gap: 4px;
      }

      .compact .current {
        font-size: 28px;
      }

      .compact .unit {
        font-size: 14px;
      }

      .compact .override-status {
        margin-top: 6px;
      }

      .compact h4,
      .compact .switch-label,
      .compact .segment span {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }

      .compact .switch-icon {
        display: inline-block;
      }

      .compact .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0 16px;
      }

      .compact .controls section {
        flex: 0 1 auto;
        margin-top: 8px;
        padding-top: 0;
        border-top: none;
      }

      .compact .controls section.expanded {
        flex-basis: 100%;
      }

      .compact .mode-section {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 12px;
      }

      .compact .mode-section .section-head {
        margin: 0;
      }

      /* wraps: four quick options do not fit a 6-column card in one row */
      .compact .segments {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .compact .segment {
        flex: 0 0 44px;
        min-height: 44px;
        padding: 0;
      }

      .compact .chip {
        min-width: 44px;
      }

      .compact .temps-section {
        margin-top: 8px;
        padding-top: 8px;
      }

      @media (prefers-reduced-motion: reduce) {
        .segment,
        .track,
        .thumb {
          transition: none;
        }
      }
    `]}};Z([Ne({attribute:!1})],Q.prototype,`hass`,void 0),Z([F()],Q.prototype,`_config`,void 0),Z([F()],Q.prototype,`_feed`,void 0),Z([F()],Q.prototype,`_feedError`,void 0),Z([F()],Q.prototype,`_now`,void 0),Z([F()],Q.prototype,`_pending`,void 0),Z([F()],Q.prototype,`_customHeat`,void 0),Z([F()],Q.prototype,`_customCool`,void 0),Z([F()],Q.prototype,`_optimisticOverride`,void 0),Z([F()],Q.prototype,`_modeDraft`,void 0),Z([F()],Q.prototype,`_controlDraft`,void 0),Z([F()],Q.prototype,`_tempsDraft`,void 0),Z([F()],Q.prototype,`_error`,void 0);var wt=`roommind-room-card`;customElements.whenDefined(`home-assistant`).then(()=>{window.customElements.get(wt)||window.customElements.define(wt,Q)});var $=window;$.customCards=$.customCards??[],$.customCards.some(e=>e.type===`roommind-room-card`)||$.customCards.push({type:`roommind-room-card`,get name(){return R(`roomcard.name`,L())},get description(){return R(`roomcard.description`,L())},preview:!0,documentationURL:`https://github.com/snazzybean/roommind#dashboard-card`})})();