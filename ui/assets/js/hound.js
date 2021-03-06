/** @jsx React.DOM */

var Signal = function() {
};

Signal.prototype = {
  listeners : [],

  tap: function(l) {
    // Make a copy of the listeners to avoid the all too common
    // subscribe-during-dispatch problem
    this.listeners = this.listeners.slice(0);
    this.listeners.push(l);
  },

  untap: function(l) {
    var ix = this.listeners.indexOf(l);
    if (ix == -1) {
      return;
    }

    // Make a copy of the listeners to avoid the all to common
    // unsubscribe-during-dispatch problem
    this.listeners = this.listeners.slice(0);
    this.listeners.splice(ix, 1);
  },

  raise: function() {
    var args = Array.prototype.slice.call(arguments, 0);
    this.listeners.forEach(function(l) {
      l.apply(this, args);
    });
  }
};

var css = function(el, n, v) {
  el.style.setProperty(n, v, '');
};

var FormatNumber = function(t) {
  var s = '' + (t|0),
      b = [];
  while (s.length > 0) {
    b.unshift(s.substring(s.length - 3, s.length));
    s = s.substring(0, s.length - 3);
  }
  return b.join(',');
};

var ParamsFromQueryString = function(qs, params) {
  params = params || {};

  if (!qs) {
    return params;
  }

  qs.substring(1).split('&').forEach(function(v) {
    var pair = v.split('=');
    if (pair.length != 2) {
      return;
    }

    params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
  });


  return params;
};

var ParamsFromUrl = function(params) {
  params = params || {
    q: '',
    i: 'nope',
    files: '',
    repos: '*',
    b: 'nope'
  };
  return ParamsFromQueryString(location.search, params);
};

var ParamValueToBool = function(v) {
  v = v.toLowerCase();
  return v == 'fosho' || v == 'true' || v == '1';
};

/**
 * The data model for the UI is responsible for conducting searches and managing
 * all results.
 */
var Model = {
  // raised when a search begins
  willSearch: new Signal(),

  // raised when a search completes
  didSearch: new Signal(),

  willLoadMore: new Signal(),

  didLoadMore: new Signal(),

  didError: new Signal(),

  didLoadRepos : new Signal(),

  ValidRepos: function(repos) {
    var all = this.repos,
        seen = {};
    return repos.filter(function(repo) {
      var valid = all[repo] && !seen[repo];
      seen[repo] = true;
      return valid;
    });
  },

  RepoCount: function() {
    return Object.keys(this.repos).length;
  },

  Load: function() {
    var _this = this;
    var next = function() {
      var params = ParamsFromUrl();
      _this.didLoadRepos.raise(_this, _this.repos);

      if (params.q !== '') {
        _this.Search(params);
      }
    };

    if (typeof ModelData != 'undefined') {
      var data = JSON.parse(ModelData),
          repos = {};
      for (var name in data) {
        repos[name] = data[name];
      }
      this.repos = repos;
      next();
      return;
    }

    $.ajax({
      url: 'api/v1/repos',
      dataType: 'json',
      success: function(data) {
        _this.repos = data;
        next();
      },
      error: function(xhr, status, err) {
        // TODO(knorton): Fix these
        console.error(err);
      }
    });
  },

  Search: function(params) {
    this.willSearch.raise(this, params);
    var _this = this,
        startedAt = Date.now();

    params = $.extend({
      stats: 'fosho',
      repos: '*',
      rng: ':20',
    }, params);

    if (params.repos === '') {
      params.repos = '*';
    }

    _this.params = params;

    // An empty query is basically useless, so rather than
    // sending it to the server and having the server do work
    // to produce an error, we simply return empty results
    // immediately in the client.
    if (params.q == '') {
      _this.results = [];
      _this.resultsByRepo = {};
      _this.didSearch.raise(_this, _this.Results);
      return;
    }

    $.ajax({
      url: 'api/v1/search',
      data: params,
      type: 'GET',
      dataType: 'json',
      success: function(data) {
        if (data.Error) {
          _this.didError.raise(_this, data.Error);
          return;
        }

        var matches = data.Results,
            stats = data.Stats,
            results = [];
        for (var repo in matches) {
          if (!matches[repo]) {
            continue;
          }

          var res = matches[repo];
          results.push({
            Repo: repo,
            Rev: res.Revision,
            Matches: res.Matches,
            FilesWithMatch: res.FilesWithMatch,
          });
        }

        results.sort(function(a, b) {
          return b.Matches.length - a.Matches.length;
        });

        var byRepo = {};
        results.forEach(function(res) {
          byRepo[res.Repo] = res;
        });

        _this.results = results;
        _this.resultsByRepo = byRepo;
        _this.stats = {
          Server: stats.Duration,
          Total: Date.now() - startedAt,
          Files: stats.FilesOpened
        };

        _this.didSearch.raise(_this, _this.results, _this.stats);
      },
      error: function(xhr, status, err) {
        _this.didError.raise(this, "The server broke down");
      }
    });
  },

  LoadMore: function(repo) {
    var _this = this,
        results = this.resultsByRepo[repo],
        numLoaded = results.Matches.length,
        numNeeded = results.FilesWithMatch - numLoaded,
        numToLoad = Math.min(2000, numNeeded),
        endAt = numNeeded == numToLoad ? '' : '' + numToLoad;

    _this.willLoadMore.raise(this, repo, numLoaded, numNeeded, numToLoad);

    var params = $.extend(this.params, {
      rng: numLoaded+':'+endAt,
      repos: repo
    });

    $.ajax({
      url: 'api/v1/search',
      data: params,
      type: 'GET',
      dataType: 'json',
      success: function(data) {
        if (data.Error) {
          _this.didError.raise(_this, data.Error);
          return;
        }

        var result = data.Results[repo];
        results.Matches = results.Matches.concat(result.Matches);
        _this.didLoadMore.raise(_this, repo, _this.results);
      },
      error: function(xhr, status, err) {
        _this.didError.raise(this, "The server broke down");
      }
    });
  },

  NameForRepo: function(repo) {
    var info = this.repos[repo];
    if (!info) {
      return repo;
    }

    var url = info.url,
        ax = url.lastIndexOf('/');
    if (ax  < 0) {
      return repo;
    }

    var name = url.substring(ax + 1).replace(/\.git$/, '');

    var bx = url.lastIndexOf('/', ax - 1);
    if (bx < 0) {
      return name;
    }

    return url.substring(bx + 1, ax) + ' / ' + name;
  },

  UrlToRepo: function(repo, burls, path, line, rev) {
    return lib.UrlToRepo(this.repos[repo], burls, path, line, rev);
  },

  UrlToCommit: function (repo, commit) {
    return lib.UrlToCommit(this.repos[repo], commit);
  },

  GetSelection: function () {

      if ( !('getSelection' in window) || !('getBoundingClientRect' in document.body) ) {
        return null;
      }

      var selection = window.getSelection();
      var anchorNode = selection.anchorNode;
      var selectionText = selection.toString().trim();
      var newLineReg = /[\r\n]+/;
      var escapeReg = /[.?*+^$[\]\\(){}|-]/g;
      var urlReg = /([\?&])q=([^&$]+)/;

      if (selectionText.length && !newLineReg.test(selectionText) && $(anchorNode).closest('.lval').length) {

          var url = window.location.href;
          var escapedText = encodeURIComponent(selectionText.replace(escapeReg, '\\$&'));
          var searchURL = url.replace(urlReg, '$1q=' + escapedText);

          var selectionRange = selection.getRangeAt(0);
          var selectionRect = selectionRange.getBoundingClientRect();
          var scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;

          return {
            text: selectionText,
            url: searchURL,
            left: selectionRect.left + selectionRect.width + 5,
            top: selectionRect.top + scrollTop + 5
          };

      }

      return null;

  },

  clearSelection: function () {
      if ( !('getSelection' in window) ) {
          return;
      }
      var selection = window.getSelection();
      selection.removeAllRanges();
  },

  getFormattedDateTime: function (time) {
    var date = new Date(time);
    return date.toString().replace(/^(\w+ \w+ \d{2} \d{4} [\d:]+).*$/, '$1');
  },

  searchBlames: function (repo, file, ls, le, dispatch) {

    var _this = this;

    var params = {
        repo: repo,
        ls: ls,
        le: le,
        filename: file
    };

    $.ajax({
        url: 'api/v1/blames',
        data: params,
        type: 'GET',
        dataType: 'json',
        success: function(data) {

            if (data.Error) {
                _this.didError.raise(_this, data.Error);
                return;
            }

            dispatch.call(null, data);

        },
        error: function(xhr, status, err) {
            _this.didError.raise(this, "The server broke down");
        }
    });

  },

  searchHistory: function (repo, file, dispatch) {
      var _this = this;

      var params = {
          repo: repo,
          filename: file
      };

      $.ajax({
          url: 'api/v1/history',
          data: params,
          type: 'GET',
          dataType: 'json',
          success: function(data) {
              if (data.Error) {
                  _this.didError.raise(_this, data.Error);
                  return;
              }

              dispatch.call(null, data);

          },
          error: function(xhr, status, err) {
              _this.didError.raise(this, "The server broke down");
          }
      });

  }

};

var RepoOption = React.createClass({
  render: function() {
    return (
      <option value={this.props.value} selected={this.props.selected}>{this.props.value}</option>
    )
  }
});

var SearchBar = React.createClass({
  componentWillMount: function() {
    var _this = this;
    Model.didLoadRepos.tap(function(model, repos) {
      _this.setState({ allRepos: Object.keys(repos) });
    });
  },

  componentDidMount: function() {
    var q = this.refs.q.getDOMNode();

    // TODO(knorton): Can't set this in jsx
    q.setAttribute('autocomplete', 'off');

    this.setParams(this.props);

    if (this.hasAdvancedValues()) {
      this.showAdvanced();
    }

    q.focus();

    $(this.refs.repos.getDOMNode()).select2();

  },
  getInitialState: function() {
    return {
      state: null,
      allRepos: [],
      repos: []
    };
  },
  queryGotKeydown: function(event) {
    switch (event.keyCode) {
    case 40:
      // this will cause advanced to expand if it is not expanded.
      this.refs.files.getDOMNode().focus();
      break;
    case 38:
      this.hideAdvanced();
      break;
    case 13:
      this.submitQuery();
      break;
    }
  },
  queryGotFocus: function(event) {
    if (!this.hasAdvancedValues()) {
      this.hideAdvanced();
    }
  },
  filesGotKeydown: function(event) {
    switch (event.keyCode) {
    case 38:
      // if advanced is empty, close it up.
      if (this.refs.files.getDOMNode().value.trim() === '') {
        this.hideAdvanced();
      }
      this.refs.q.getDOMNode().focus();
      break;
    case 13:
      this.submitQuery();
      break;
    }
  },
  filesGotFocus: function(event) {
    this.showAdvanced();
  },
  submitQuery: function() {
    this.props.onSearchRequested(this.getParams());
  },
  getRegExp : function() {
    return new RegExp(
      this.refs.q.getDOMNode().value.trim(),
      this.refs.icase.getDOMNode().checked ? 'ig' : 'g');
  },
  getParams: function() {
    // selecting all repos is the same as not selecting any, so normalize the url
    // to have none.
    var reposArray = $(this.refs.repos.getDOMNode()).val();
    var repos = Model.ValidRepos(reposArray || []);
    if (repos.length == Model.RepoCount()) {
      repos = [];
    }

    return {
      q : this.refs.q.getDOMNode().value.trim(),
      files : this.refs.files.getDOMNode().value.trim(),
      repos : repos.join(','),
      i: this.refs.icase.getDOMNode().checked ? 'fosho' : 'nope',
      b: this.refs.burls.getDOMNode().checked ? 'fosho' : 'nope'
    };
  },
  setParams: function(params) {
    var q = this.refs.q.getDOMNode(),
        i = this.refs.icase.getDOMNode(),
        files = this.refs.files.getDOMNode(),
        b = this.refs.burls.getDOMNode();

    q.value = params.q;
    i.checked = ParamValueToBool(params.i);
    b.checked = ParamValueToBool(params.b);
    files.value = params.files;
  },
  hasAdvancedValues: function() {
    return
      this.refs.files.getDOMNode().value.trim() !== '' ||
      this.refs.icase.getDOMNode().checked ||
      this.refs.burls.getDOMNode().checked ||
      $(this.refs.repos.getDOMNode()).val();
  },
  showAdvanced: function() {
    var adv = this.refs.adv.getDOMNode(),
        ban = this.refs.ban.getDOMNode(),
        q = this.refs.q.getDOMNode(),
        files = this.refs.files.getDOMNode();

    css(adv, 'height', 'auto');
    css(adv, 'padding', '10px 0');

    css(ban, 'max-height', '0');
    css(ban, 'opacity', '0');

    if (q.value.trim() !== '') {
      files.focus();
    }

    $(this.refs.repos.getDOMNode()).trigger('change');
  },
  hideAdvanced: function() {
    var adv = this.refs.adv.getDOMNode(),
        ban = this.refs.ban.getDOMNode(),
        q = this.refs.q.getDOMNode();

    css(adv, 'height', '0');
    css(adv, 'padding', '0');

    css(ban, 'max-height', '100px');
    css(ban, 'opacity', '1');

    q.focus();
  },
  render: function() {
    var repoCount = this.state.allRepos.length,
        repoOptions = [],
        selected = {};

    this.state.repos.forEach(function(repo) {
      selected[repo] = true;
    });

    this.state.allRepos.forEach(function(repoName) {
      repoOptions.push(<RepoOption value={repoName} selected={selected[repoName]}/>);
    });

    var stats = this.state.stats;
    var statsView = '';
    if (stats) {
      statsView = (
        <div className="stats">
          <div className="stats-left">
            <a href="excluded_files.html"
              className="link-gray">
                Excluded Files
            </a>
          </div>
          <div className="stats-right">
            <div className="val">{FormatNumber(stats.Total)}ms total</div> /
            <div className="val">{FormatNumber(stats.Server)}ms server</div> /
            <div className="val">{stats.Files} files</div>
          </div>
        </div>
      );
    }

    return (
      <div id="input">
        <div id="ina">
          <input id="q"
              type="text"
              placeholder="Search by Regexp"
              ref="q"
              autocomplete="off"
              onKeyDown={this.queryGotKeydown}
              onFocus={this.queryGotFocus}/>
          <div className="button-add-on">
            <button id="dodat" onClick={this.submitQuery}></button>
          </div>
        </div>

        <div id="inb">
          <div id="adv" ref="adv">
            <span className="octicon octicon-chevron-up hide-adv" onClick={this.hideAdvanced}></span>
            <div className="field">
              <label htmlFor="files">File Path</label>
              <div className="field-input">
                <input type="text"
                    id="files"
                    placeholder="/regexp/"
                    ref="files"
                    onKeyDown={this.filesGotKeydown}
                    onFocus={this.filesGotFocus} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="ignore-case">Ignore Case</label>
              <div className="field-input">
                <input id="ignore-case" type="checkbox" ref="icase" />
              </div>
            </div>
            <div className="field">
              <label className="multiselect_label" htmlFor="repos">Select Repo</label>
              <div className="field-input">
                <select id="repos" className="form-control multiselect" multiple={true} size={Math.min(16, repoCount)} ref="repos">
                  {repoOptions}
                </select>
              </div>
            </div>
              <div className="field">
                  <label htmlFor="blame-urls">Blame URLs</label>
                  <div className="field-input">
                      <input id="blame-urls" type="checkbox" ref="burls" />
                  </div>
              </div>
          </div>
          <div className="ban" ref="ban" onClick={this.showAdvanced}>
            <em>Advanced:</em> ignore case, filter by path, stuff like that.
          </div>
        </div>
        {statsView}
      </div>
    );
  }
});

/**
 * Take a list of matches and turn it into a simple list of lines.
 */
var MatchToLines = function(match) {
  var lines = [],
      base = match.LineNumber,
      nBefore = match.Before.length,
      nAfter = match.After.length;
  match.Before.forEach(function(line, index) {
    lines.push({
      Number : base - nBefore + index,
      Content: line,
      Match: false
    });
  });

  lines.push({
    Number: base,
    Content: match.Line,
    Match: true
  });

  match.After.forEach(function(line, index) {
    lines.push({
      Number: base + index + 1,
      Content: line,
      Match: false
    });
  });

  return lines;
};

/**
 * Take several lists of lines each representing a matching block and merge overlapping
 * blocks together. A good example of this is when you have a match on two consecutive
 * lines. We will merge those into a singular block.
 *
 * TODO(knorton): This code is a bit skanky. I wrote it while sleepy. It can surely be
 * made simpler.
 */
var CoalesceMatches = function(matches) {
  var blocks = matches.map(MatchToLines),
      res = [],
      current;
  // go through each block of lines and see if it overlaps
  // with the previous.
  for (var i = 0, n = blocks.length; i < n; i++) {
    var block = blocks[i],
        max = current ? current[current.length - 1].Number : -1;
    // if the first line in the block is before the last line in
    // current, we'll be merging.
    if (block[0].Number <= max) {
      block.forEach(function(line) {
        if (line.Number > max) {
          current.push(line);
        } else if (current && line.Match) {
          // we have to go back into current and make sure that matches
          // are properly marked.
          current[current.length - 1 - (max - line.Number)].Match = true;
        }
      });
    } else {
      if (current) {
        res.push(current);
      }
      current = block;
    }
  }

  if (current) {
    res.push(current);
  }

  return res;
};

/**
 * Use the DOM to safely htmlify some text.
 */
var EscapeHtml = function(text) {
  var e = EscapeHtml.e;
  e.textContent = text;
  return e.innerHTML;
};
EscapeHtml.e = document.createElement('div');

/**
 * Produce html for a line using the regexp to highlight matches.
 */
var ContentFor = function(line, regexp) {
  if (!line.Match) {
    return EscapeHtml(line.Content);
  }
  var content = line.Content,
      buffer = [];

  while (true) {
    regexp.lastIndex = 0;
    var m = regexp.exec(content);
    if (!m) {
      buffer.push(EscapeHtml(content));
      break;
    }

    buffer.push(EscapeHtml(content.substring(0, regexp.lastIndex - m[0].length)));
    buffer.push( '<em>' + EscapeHtml(m[0]) + '</em>');
    content = content.substring(regexp.lastIndex);
  }
  return buffer.join('');
};

var Line = React.createClass({

    getInitialState: function() {
        return {
          blame: null
        };
    },

    render: function () {

      var filename = this.props.filename,
          repo = this.props.repo,
          rev = this.props.rev,
          burls = this.props.burls,
          regexp = this.props.regexp
          line = this.props.line;

      var content = ContentFor(line, regexp);
      var blameBlock = this.state.blame
          ? (
              <div className="blame">
                  <a
                      href={Model.UrlToCommit(repo, this.state.blame[0])}
                      title={this.state.blame[2] + " " + Model.getFormattedDateTime(this.state.blame[1])}
                      target="_blank"
                  >
                    {this.state.blame[0]}
                  </a>
              </div>
          )
          : "";

      return (
          <div className="line">
              <a href={Model.UrlToRepo(repo, burls, filename, line.Number, rev)}
                 className="lnum"
                 target="_blank"
              >
                  {line.Number}
              </a>
              {blameBlock}
              <span className="lval" dangerouslySetInnerHTML={{__html:content}} />
          </div>
      );

    }
});

var Block = React.createClass({

    loadBlameBlocks: function () {

        var Lines = this.refs.Lines;
        var children = Lines.props.children;
        var ls = children[0].props.line.Number;
        var le = children[children.length - 1].props.line.Number;

        Model.searchBlames(this.props.repo, this.props.filename, ls, le, function (data) {

          var parseData = data.Matches.reduce(function (obj, line) {

            obj[line.Line] = line.GitBlame;

            return obj;

          }, {});

          var childProp;

          for (childProp in Lines._renderedChildren) {

              if (Lines._renderedChildren.hasOwnProperty(childProp)) {

                var line = Lines._renderedChildren[childProp];
                var ln = line.props.line.Number;

                if (parseData.hasOwnProperty(ln)) {

                  line.setState({
                      blame: parseData[ln]
                  });

                }

              }

          }

        });

    },

    render: function () {

      var filename = this.props.filename,
          repo = this.props.repo,
          rev = this.props.rev,
          block = this.props.block,
          burls = this.props.burls,
          regexp = this.props.regexp;

      var lines = block.map(function (line) {

        return (
            <Line
                filename={filename}
                repo={repo}
                rev={rev}
                regexp={regexp}
                burls={burls}
                line={line}
            />
        );
      });

      return (
          <div className="match" ref="Lines">
              {lines}
          </div>
      );
    }

});

var File = React.createClass({

    getInitialState: function() {
        return {
            history: null
        };
    },

    copyToClipboard: function(e) {

        var textarea = this.refs.CopyFilename.getDOMNode();

        textarea.style.display = 'block';
        textarea.select();
        document.execCommand('copy');
        textarea.style.display = '';

    },

    getBlames: function () {

      this.refs.GetBlamesButton.getDOMNode().setAttribute('disabled', 'disabled');

      var FileBody = this.refs.FileBody;
      var childProp;

      for (childProp in FileBody._renderedChildren) {

        if (FileBody._renderedChildren.hasOwnProperty(childProp)) {

            FileBody._renderedChildren[childProp].loadBlameBlocks();

        }

      }

    },

    getHistory : function () {

      var _this = this;

      this.refs.GetHistoryButton.getDOMNode().setAttribute('disabled', 'disabled');

      Model.searchHistory(this.props.repo, this.props.file.Filename, function (data) {

        _this.setState({
            history: data.Matches
        });

      });

    },

    render: function () {

      var file = this.props.file,
          rev = this.props.rev,
          repo = this.props.repo,
          regexp = this.props.regexp,
          burls = this.props.burls;

      var lineBlocks = CoalesceMatches(file.Matches);

      var blocks = lineBlocks.map(function (block) {

        return (
            <Block
                filename={file.Filename}
                repo={repo}
                rev={rev}
                block={block}
                burls={burls}
                regexp={regexp}
            />
        );

      });

      var tds = this.state.history
        ? this.state.history.map(function (commit) {
              return (
                  <tr>
                      <td><a href={Model.UrlToCommit(repo, commit.GitHistory[0])} target="_blank">{commit.GitHistory[0]}</a></td>
                      <td className="table-ellipsis" title={commit.GitHistory[3]}>
                          <span>
                              {commit.GitHistory[3]}
                          </span>
                      </td>
                      <td className="table-ellipsis">
                          <span>
                              {commit.GitHistory[2]}
                          </span>
                      </td>
                      <td>{Model.getFormattedDateTime(commit.GitHistory[1])}</td>
                  </tr>
              );
          })
        : "";

      var history = this.state.history
        ? (
            <table className="last-commits">
                <thead>
                    <th width="10%">Sha</th>
                    <th width="40%">Commit message</th>
                    <th width="25%">User</th>
                    <th width="25%">Time</th>
                </thead>
                <tbody>
                    {tds}
                </tbody>
            </table>
          )
        : "";

      return (
          <div className="file">
              <div className="title">
                  <a href={Model.UrlToRepo(repo, burls, file.Filename, null, rev)}>
                      {file.Filename}
                  </a>
                  <a className="octicon octicon-clippy copyFilepath" onClick={this.copyToClipboard.bind(this)} title='Copy to clipboard'></a>
                  <button className="commits-button get-blames" onClick={this.getBlames.bind(this)} ref="GetBlamesButton">Blame this file</button>
                  <button className="commits-button get-history" onClick={this.getHistory.bind(this)} ref="GetHistoryButton">Last commits</button>
                  {history}
              </div>
              <div className="file-body" ref="FileBody">
                  {blocks}
              </div>
              <textarea ref="CopyFilename">{file.Filename}</textarea>
          </div>
      );
    }
});

var FilesView = React.createClass({
  onLoadMore: function(event) {
    Model.LoadMore(this.props.repo);
  },

  render: function() {

    var rev = this.props.rev,
        repo = this.props.repo,
        regexp = this.props.regexp,
        matches = this.props.matches,
        burls = this.props.burls,
        totalMatches = this.props.totalMatches;

    var files = matches.map(function(file) {

        return (
            <File
                repo={repo}
                regexp={regexp}
                burls={burls}
                file={file}
                rev={rev}
            />
        );

    });

    var more = '';

    if (files.length < totalMatches) {
        more = <button className="moar" onClick={this.onLoadMore}>Load all {totalMatches} matches in {Model.NameForRepo(repo)}</button>;
    }

    return (
        <div className="files">
            {files}
            {more}
        </div>
    );


  }
});

var ResultView = React.createClass({
  componentWillMount: function() {
    var _this = this;
    Model.willSearch.tap(function(model, params) {
      _this.setState({
        results: null,
        query: params.q,
        burls: params.b
      });
    });
  },
  getInitialState: function() {
    return { results: null };
  },
  render: function() {
    if (this.state.error) {
      return (
        <div id="no-result" className="error">
          <strong>ERROR:</strong>{this.state.error}
        </div>
      );
    }

    if (!!this.state.results && this.state.results.length === 0) {
      // TODO(knorton): We need something better here. :-(
      return (
        <div id="no-result">&ldquo;Nothing for you, Dawg.&rdquo;<div>0 results</div></div>
      );
    }

    if (!this.state.results && this.state.query) {
      return (
        <div id="no-result"><img src="images/busy.gif" /><div>Searching...</div></div>
      );
    }

    var regexp = this.state.regexp,
        results = this.state.results || [],
        burls = this.state.burls;

    var repos = results.map(function(result, index) {
      return (
        <div className="repo">
          <div className="title">
            <span className="mega-octicon octicon-repo"></span>
            <span className="name">{Model.NameForRepo(result.Repo)}</span>
          </div>
          <FilesView
              matches={result.Matches}
              rev={result.Rev}
              repo={result.Repo}
              regexp={regexp}
              totalMatches={result.FilesWithMatch}
              burls={burls} />
        </div>
      );
    });
    return (
      <div id="result">{repos}</div>
    );
  }
});

var SelectionToolTip = React.createClass({
  getInitialState: function() {
      return { active: false };
  },
  isActive: function () {
    return this.state.active;
  },
  onClickTooltip: function (e) {
    e.stopPropagation();
    var _this = this;
    setTimeout(function () {
      Model.clearSelection();
      _this.setState({
          active: false
      });
    }, 100);
  },
  render: function () {
    return (
        <a
            className={ this.state.active ? 'selection-tooltip active' : 'selection-tooltip' }
            href={this.state.url}
            style={{ top: this.state.top, left: this.state.left }}
            onClick={this.onClickTooltip}
            target='_blank'
        >
            {this.state.text}
        </a>
    );
  }
});

var App = React.createClass({
  componentWillMount: function() {
    var params = ParamsFromUrl(),
        repos = (params.repos == '') ? [] : params.repos.split(',');

    this.setState({
      q: params.q,
      i: params.i,
      b: params.b,
      files: params.files,
      repos: repos
    });

    var _this = this;
    Model.didLoadRepos.tap(function(model, repos) {
      // If all repos are selected, don't show any selected.
      if (model.ValidRepos(_this.state.repos).length == model.RepoCount()) {
        _this.setState({repos: []});
      }
    });

    Model.didSearch.tap(function(model, results, stats) {
      _this.refs.searchBar.setState({
        stats: stats,
        repos: repos,
      });

      _this.refs.resultView.setState({
        results: results,
        regexp: _this.refs.searchBar.getRegExp(),
        error: null
      });
    });

    Model.didLoadMore.tap(function(model, repo, results) {
      _this.refs.resultView.setState({
        results: results,
        regexp: _this.refs.searchBar.getRegExp(),
        error: null
      });
    });

    Model.didError.tap(function(model, error) {
      _this.refs.resultView.setState({
        results: null,
        error: error
      });
    });

    window.addEventListener('popstate', function(e) {
      var params = ParamsFromUrl();
      _this.refs.searchBar.setParams(params);
      Model.Search(params);
    });

    document.addEventListener('click', function () {

      clearTimeout(_this.toolTipDelay);

      _this.toolTipDelay = setTimeout(function () {

        var selection = Model.GetSelection();

        if (selection) {

            _this.refs.SelectionToolTip.setState({
                active  : true,
                text    : selection.text,
                url     : selection.url,
                top     : selection.top,
                left    : selection.left
            });

        } else if ( _this.refs.SelectionToolTip.isActive() ) {

            _this.refs.SelectionToolTip.setState({
                active  : false
            });

        }

      }, 50);

    });

  },
  onSearchRequested: function(params) {
    this.updateHistory(params);
    Model.Search(this.refs.searchBar.getParams());
  },
  updateHistory: function(params) {
    var path = location.pathname +
      '?q=' + encodeURIComponent(params.q) +
      '&i=' + encodeURIComponent(params.i) +
      '&b=' + encodeURIComponent(params.b) +
      '&files=' + encodeURIComponent(params.files) +
      '&repos=' + params.repos;
    history.pushState({path:path}, '', path);
  },
  render: function() {
    return (
      <div>
        <SearchBar ref="searchBar"
            q={this.state.q}
            i={this.state.i}
            files={this.state.files}
            b={this.state.b}
            repos={this.state.repos}
            onSearchRequested={this.onSearchRequested} />
        <ResultView ref="resultView" q={this.state.q} burls={this.state.b} />
        <SelectionToolTip ref="SelectionToolTip" />
      </div>
    );
  }
});

React.renderComponent(
  <App />,
  document.getElementById('root')
);
Model.Load();