import ReactDOM from 'react-dom';
import { XObject } from './XObject';
import styled from 'styled-components';
import _ from 'lodash';
import md5 from 'md5';

export class StillLoading extends Error {
  constructor(public arg?) {
    super()
  }
}

export function css(strings, ...interpolations) {
  for (let i of interpolations) {
    if (_.isFunction(i) && !(i as any).styledComponentId || _.isArray(i)) {
      return [ ...arguments ];
    }
  }

  let str = '';
  for (let i = 0; i < strings.length; ++i) {
    str += strings[i] + (interpolations[i] === undefined || interpolations[i] === false ? '' : interpolations[i]);
  }
  return str;
}

function aliasStyledComponent(comp, styledComponent) {
  comp.toString = () => styledComponent.toString();
  comp[Symbol.toPrimitive] = () => styledComponent.toString();
  comp.valueOf = () => styledComponent.toString();
  comp.styledComponentId = styledComponent.styledComponentId;

  return comp;
}

function genStyled(tag, styles) {
  return styled[tag](...(styles || ['']));
}

function makeStyled(constructor, StyledComp) {
  aliasStyledComponent(constructor, StyledComp);
  const { render } = constructor.prototype;

  if (constructor.debug) {
    console.log(render.length);
  }
  if (!render) {
    constructor.prototype.render = function() {
      return <StyledComp {...this.props} />;
    }
  }
  else if (render.length == 1) {
    constructor.prototype.render = function() {
      return render.call(this, StyledComp);
    }
  }
  else {
    constructor.prototype.render = function() {
      return <StyledComp {...this.props}>{render.call(this)}</StyledComp>;
    }
  }
}

let nextReactiveId = 0;

export const reactiveCompMap = {};

let renderCount = 0;
let updateCount = 0;
function makeReactive(constructor) {
  const { render, componentWillUnmount, componentDidMount, componentDidUpdate } = constructor.prototype;

  constructor.prototype.trackObserver = function(obj, prop, observer, tag) {
    if (!this.observingMap) this.observingMap = {};
    if (!this.observing) this.observing = [];
    if (!this.__versions) this.__versions = {};
    const key = `${obj[XObject._idSymbol]}.${prop?.toString?.()}`;
    // this.__versions[key] = obj[XObject._versionsSymbol][prop];
    if (!this.observingMap[key]) {
      this.observingMap[key] = true;
      this.observing.push({ obj, prop, observer, tag });
      return true;
    }
  }

  constructor.prototype.componentDidMount = function() {
    const id = nextReactiveId++;
    const domNode = ReactDOM.findDOMNode(this) as Element;

    reactiveCompMap[id] = this;
    this.__reactiveId = id;
    // this.__reactiveMeta = X({});
    // this.__reactiveMeta.updateCount = 0;

    if (domNode?.setAttribute) {
      domNode.setAttribute('data-reactive', id.toString());
    }
    else {
      // console.log(this, this.__name, domNode);
    }
    
    if (componentDidMount) componentDidMount.call(this);
  }

  constructor.prototype.componentDidUpdate = function() {
    const domNode = ReactDOM.findDOMNode(this) as Element;
    if (domNode?.getAttribute && !domNode.getAttribute('data-reactive')) {
      domNode.setAttribute('data-reactive', this.__reactiveId);
    }

    if (componentDidUpdate) componentDidUpdate.apply(this, arguments);
  }

  constructor.prototype.render = function() {
    // let timerId;
    ++ renderCount;
    if (render) {
      if (this.observing) for (const { obj, prop, observer } of this.observing) {
        XObject.removeObserver(obj, prop, observer);
      }
      this.observing = [];
      this.observingMap = {};
      this.__versions = {};

      return XObject.captureAccesses(() => {
        if ((this.catchErrors || this.props.catchErrors)) {
          try {
            const r = render.call(this);
            if (r === undefined) return null;
            return r;
          }
          catch (e) {
            if (e instanceof StillLoading) {
              // console.log(e);
              return <span>Loading...</span>;
            }
            console.log('ERRROR', e);
            return <span>error</span>;
          }
        }
        else {
          try {
            const r = render.call(this);
            if (r === undefined) return null;
            return r;
          }
          catch (e) {
            if (e instanceof StillLoading) {
              // console.log(e);
              return <span>Loading...</span>;
            }
            else {
              console.log('ERRROR', e);
              return 'error';
            }
          }
        }
      }, (obj, prop) => {
        const observer = (...args) => {

          if (constructor.debounce !== false) {
            clearTimeout(this.__timerId);
            this.__timerId = setTimeout(() => {
              ++ updateCount;
              this.forceUpdate();
              // try {
              //   // console.log(this, ReactDOM.findDOMNode(this), args);
              //   // this.__reactiveMeta.timestamp = Date.now();
              //   // this.__reactiveMeta.updateCount++;
                
              // }
              // catch (e) {
              //   console.log('failed to update', this);
              // }
            }, 100);
          }
          else {
            ++ updateCount;
            this.forceUpdate();
          }


        }
        if (this.trackObserver(obj, prop, observer, 1)) {
          XObject.observe(obj, prop, observer);
        }
      });  
    }
    else {
      return null;
    }
  }

  constructor.prototype.componentWillUnmount = function() {
    delete reactiveCompMap[this.__reactiveId];
    if (this.observing) {
      for (const { obj, prop, observer, tag } of this.observing) {
        XObject.removeObserver(obj, prop, observer)
      }
      delete this.observing;
      delete this.observingMap;
    }

    if (componentWillUnmount) componentWillUnmount.call(this);
  }
}

export function generateClassName(name='') {
  return name + '_' + md5(Math.random().toString());
}

function generateClassNames(c) {
  const generated = {};
  for (const name in c) {
    if (c[name] == '') generated[name] = generateClassName(name);
    else if (_.isPlainObject(c[name])) {
      generated[name] = Object.assign(generateClassName(name), generateClassNames(c[name]))
    }
    else generated[name] = c[name];
  }
  return generated;
}

export const component = new Proxy(() => {}, {
  apply(target, thisArg, args) {
    if (args[0] instanceof Function) {
      const [ constructor ] = args;
      if (constructor.c) {
        constructor.c = generateClassNames(constructor.c);
      }
      if (constructor.styles) {
        makeStyled(constructor, _.isFunction(constructor.styles) ? constructor.styles(constructor.classes) : constructor.styles);
      }
      makeReactive(constructor);
      return constructor;
    }
    else {
      const [ styles ] = args;
      return constructor => {
        if (styles.styledComponentId) {
          makeStyled(constructor, styles);
        }
        else {
          makeStyled(constructor, genStyled('div', styles));
        }  

        makeReactive(constructor);
      }
    }
  },
  get(target, tag) {
    return styles => {
      return constructor => {
        makeStyled(constructor, genStyled(tag, styles));
        makeReactive(constructor);
      }
    }
  }
}) as (<T>(constructor: T) => T);
