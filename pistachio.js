var Pistachio = (typeof module !== "undefined" && module.exports) || {};

;(function(exports) {

  exports.parse = parse;
  exports.render = render;

  /**
   * Scanner
   */

  function Scanner(str) {
    this.raw = str;
    this.str = str;
    this.pos = 0;
  }

  Scanner.prototype = {

    eos: function() {
      return !this.str;
    },

    startOfLine: function() {
      return (!this.pos || (this.raw.charAt(this.pos-1) === '\n'));
    },

    scan: function(re) {
      var match = this.str.match(re);
      if (!match || (match.index > 0)) return null;
      this.str = this.str.substring(match[0].length);
      this.pos += match[0].length;
      return match[0];
    },

    scanUntil: function(re) {
      var match
        , pos = this.str.search(re);

      switch (pos) {
        case -1 :
          match = this.str;
          this.pos += this.str;
          this.str = ''
          break;
        case 0  :
          match = null;
          break;
        default :
          match = this.str.substring(0, pos);
          this.str = this.str.substring(pos);
          this.pos += pos;
      }
      return match;
    },

  }

  /**
   * Parser
   */

  var parseCache = {};

  function parse(template, options) {
    options = options || {};
    p = new Parser();
    return p.parse(template, options);
  }

  function Parser() {
    this.tokens = [];
    this.tokenCollector = this.tokens;
    this.sections = [];
    this.otag = '{{';
    this.ctag = '}}';
    this.compileRegexen();
  }

  Parser.prototype = {

    compileRegexen: function() {
      this.re.opentag = new RegExp('(?:([ \\t]*))?' + RE(this.otag));
      this.re.closetag = new RegExp('[\\}!=]?' + RE(this.ctag));
    },

    re: {
      newline: /\r?\n/,
      whitespace: /[ \t]*/,
      trailing: /[ \t]*(?:\r?\n|$)/,
      tagtype: /\{|&|#|\^|\/|>|=|!/,
      allowed: /[\w\$\.]+/,
      linebeginnings: /(^|\n)([^\r\n])/g
    },

    standalone: function(type) {
      return type && type !== '{' && type !== '&';
    },

    addIndentationTo: function(str, indent) {
      return str.replace(this.re.linebeginnings, '$1' + indent + '$2');
    },

    parse: function(str, options) {
      options = options || {};
      if (options.indent) {
        str = this.addIndentationTo(str, options.indent)
      }
      if (options.otag) {
        this.otag = options.otag;
        this.ctag = options.ctag;
        this.compileRegexen();
      }
      this.scanner = new Scanner(str);
      while (!this.scanner.eos()) this.scanTags();
      return this.tokens;
    },

    scanTags: function() {
      var otag, padding, type, content, startOfLine, start, end
        , standAlone = false;

      this.scanText();

      startOfLine = this.scanner.startOfLine();
      start = this.scanner.pos;

      // Match the opening tag.
      if (!(otag = this.scanner.scan(this.re.opentag))) return;

      // Handle leading whitespace
      padding = this.re.whitespace.exec(otag);
      padding = padding && padding[0];
      start += padding.length;

      // Get the tag's type.
      type = this.scanner.scan(this.re.tagtype);
      type = type && type[0];

      // Skip whitespace.
      this.scanner.scan(this.re.whitespace);

      // Get the tag's inner content.
      if (type === '!' || type === '=') {
        content = this.scanner.scanUntil(this.re.closetag);
      } else {
        content = this.scanner.scan(this.re.allowed);
      }

      // Skip whitespace again.
      this.scanner.scan(this.re.whitespace);

      // Closing tag.
      if (!this.scanner.scan(this.re.closetag)) {
        throw new Error('Unclosed tag');
      }

      // Strip leading and trailing whitespace if necessary.
      if (startOfLine && this.standalone(type) &&
          (this.scanner.scan(this.re.trailing) !== null)) {
          standAlone = true;
      }

      if (!standAlone) {
        this.addText(padding);
        padding = '';
      }

      end = this.scanner.pos;

      this.addTag(type, content, padding, start, end);
    },

    scanText: function(str) {
      var text = this.scanner.scanUntil(this.re.opentag);
      this.addText(text);
    },

    addText: function(text) {
      this.text(text);
    },

    addTag: function(type, content, padding, start, end) {
      switch (type) {
        case '=':
          this.setDelimiters(content);
          break;
        case '!':
          break;
        case '#':
          this.openSection(content, {invert: false, start: end});
          break;
        case '^':
          this.openSection(content, {invert: true, start: end});
          break;
        case '/':
          this.closeSection(content, {end: start});
          break;
        case '>':
          this.partial(content, padding);
          break;
        case '{':
        case '&':
          this.variable(content, {escape: false});
          break;
        default :
          this.variable(content, {escape: true});
          break;
      }
    },

    setDelimiters: function(content) {
      var tags = content.split(/\s+/);
      this.otag = tags[0];
      this.ctag = tags[1];
      this.compileRegexen();
    },

    openSection: function(content, options) {
      var section = {
        type: 'section',
        inverted: options.invert,
        key: content,
        tokens: [],
        raw: options.start
      };
      this.tokenCollector.push(section);
      this.sections.push(section);
      this.tokenCollector = section.tokens;
    },

    closeSection: function(content, options) {
      var section, last;

      if (this.sections.length === 0) {
        throw new Error('Unopened section: ' + content);
      }

      section = this.sections.pop();
      if (section.key !== content) {
        throw new Error('Unclosed section: ' + section.key);
      }

      section.raw = this.scanner.raw.substring(section.raw, options.end);
      section.otag = this.otag;
      section.ctag = this.ctag;

      last = this.sections.length - 1;

      this.tokenCollector =
        this.sections.length ? this.sections[last].tokens : this.tokens;
    },

    partial: function(content, padding) {
      this.tokenCollector.push({
        type: 'partial',
        key: content,
        indent: padding
      });
    },

    variable: function(content, options) {
      this.tokenCollector.push({
        type: 'variable',
        key: content,
        escape: options.escape
      });
    },

    text: function(text) {
      var last = this.tokenCollector.length - 1;
      if (!text) return;
      if ((last >= 0) && (this.tokenCollector[last].type === 'text')) {
        this.tokenCollector[last].value += text;
      } else {
        this.tokenCollector.push({
          type: 'text',
          value: text
        });
      }
    },

  }

  /**
   * render
   */

  function evaluate(tokens, data, partials) {
    var token, s, value, context, j, jlen
      , buffer = ''
      , stack = isArray(data) ? data : [data]
      , i = 0
      , len = tokens.length

    for (; i < len; i++) {
      token = tokens[i];
      switch (token.type) {
        case 'text':
          buffer += token.value;
          break;
        case 'variable':
          value = lookup(stack, token.key);
          if (typeof value === 'function') {
            s = render(stringify(value.call(data)), stack, partials);
          } else {
            s = stringify(value);
          }
          buffer += token.escape ? escapeHTML(s) : s;
          break;
        case 'section':
          context = lookup(stack, token.key);
          if (typeof context === 'function') {
            buffer += render(
              stringify(context.call(data, token.raw)),
              stack,
              partials,
              {otag: token.otag, ctag: token.ctag}
            );
            break;
          }
          shouldRender = isArray(context) ? !!context.length : !!context;
          if ((shouldRender && !token.inverted) ||
              (!shouldRender && token.inverted)) {
            if (isArray(context) && !token.inverted) {
              for (j = 0, jlen = context.length; j < jlen; j++) {
                buffer += evaluate(
                  token.tokens,
                  stack.concat(context[j]),
                  partials
                );
              }
            } else {
              buffer += evaluate(
                token.tokens,
                stack.concat(context),
                partials
              );
            }
          }
          break;
        case 'partial':
          buffer += render(
            partials[token.key],
            data,
            partials,
            {indent: token.indent}
          );
          break;

      }
    }

    return buffer;
  }

  var parseCache = {};
  var compileCache = {};

  function compile(template, data, partials, options) {
    var tokens, lookup;
    options = options || {};
    lookup = template + options.indent;

    if (!parseCache[lookup]) parseCache[lookup] = parse(template, options);
    tokens = parseCache[lookup];

    if (!compileCache[lookup]) {
      compileCache[lookup] = function(data, partials) {
        return evaluate(tokens, data, partials);
      }
    }
    return compileCache[lookup];
  }

  function render(template, data, partials, options) {
    return compile(template, data, partials, options)(data, partials);
  };

  /**
   * Utilities
   */

  function getValue(obj, key) {
    var keys, i, len
      , value = obj;

    if (key === '.') return value;

    keys = key.split('.');
    for (i = 0, len = keys.length; i < len; i++) {
      if (!value) return undefined;
      value = value[keys[i]];
    }

    return value;
  }

  function lookup(stack, key) {
    var value
      , i = stack.length - 1;

    for (; i >= 0; i--) {
      value = getValue(stack[i], key);
      if (value) return value;
    }
    return undefined;
  }

  function stringify(obj) {
    return obj ? obj.toString() : '';
  }

  var isArray = Array.isArray || function(obj) {
    return Object.prototype.toString.call(obj) == '[object Array]';
  };

  var escapeChars = {
    '&': '&amp;',
    '"': '&quot;',
    '<': '&lt;',
    '>': '&gt;'
  }

  function escapeHTML(str) {
    return str.replace(/[&"<>]/g, function(str) {
      return escapeChars[str];
    });
  }

  // Credit to Simon Willison and Colin Snover:
  // http://simonwillison.net/2006/Jan/20/escape/
  function RE(str) {
    return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
  }

})(Pistachio);
