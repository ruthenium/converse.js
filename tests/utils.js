(function (root, factory) {
    define("test_utils", ['converse', 'mock'], factory);
}(this, function (converse_api, mock) {
    var $ = converse_api.env.jQuery;
    var $pres = converse_api.env.$pres;
    var $iq = converse_api.env.$iq;
    var Strophe = converse_api.env.Strophe;
    var utils = {};

    utils.createRequest = function (iq) {
        iq = typeof iq.tree == "function" ? iq.tree() : iq;
        var req = new Strophe.Request(iq, function() {});
        req.getResponse = function () {
            var env = new Strophe.Builder('env', {type: 'mock'}).tree();
            env.appendChild(iq);
            return env;
        };
        return req;
    };

    utils.closeAllChatBoxes = function (converse) {
        var i, chatbox;
        for (i=converse.chatboxes.models.length-1; i>-1; i--) {
            chatbox = converse.chatboxes.models[i];
            converse.chatboxviews.get(chatbox.get('id')).close();
        }
        return this;
    };

    utils.removeAllChatBoxes = function () {
        var i, chatbox, num_chatboxes = converse.chatboxes.models.length;
        for (i=num_chatboxes-1; i>-1; i--) {
            chatbox = converse.chatboxes.models[i];
            converse.chatboxviews.get(chatbox.get('id')).close();
            converse.chatboxviews.get(chatbox.get('id')).$el.remove();
        }
        converse.chatboxviews.get('controlbox').close();
        converse.chatboxviews.get('controlbox').$el.remove();
        return this;
    };

    utils.initConverse = function () {
        converse._tearDown();
        converse._initialize();
    };

    utils.initRoster = function () {
        converse.roster.browserStorage._clear();
        converse.initRoster();
    };

    utils.openControlBox = function () {
        var $toggle = $(".toggle-controlbox");
        if (!$("#controlbox").is(':visible')) {
            if (!$toggle.is(':visible')) {
                $toggle[0].classList.remove('hidden');
                $toggle.click();
            } else {
                $toggle.click();
            }
        }
        return this;
    };

    utils.closeControlBox = function () {
        if ($("#controlbox").is(':visible')) {
            $("#controlbox").find(".close-chatbox-button").click();
        }
        return this;
    };

    utils.removeControlBox = function () {
        converse.controlboxtoggle.show();
        $('#controlbox').remove();
    };

    utils.openContactsPanel = function (converse) {
        this.openControlBox(converse);
        var cbview = converse.chatboxviews.get('controlbox');
        var $tabs = cbview.$el.find('#controlbox-tabs');
        $tabs.find('li').first().find('a').click();
    };

    utils.openRoomsPanel = function (converse) {
        utils.openControlBox();
        var cbview = converse.chatboxviews.get('controlbox');
        var $tabs = cbview.$el.find('#controlbox-tabs');
        $tabs.find('li').last().find('a').click();
    };

    utils.openChatBoxes = function (converse, amount) {
        var i = 0, jid, views = [];
        for (i; i<amount; i++) {
            jid = mock.cur_names[i].replace(/ /g,'.').toLowerCase() + '@localhost';
            views[i] = converse.roster.get(jid).trigger("open");
        }
        return views;
    };

    utils.openChatBoxFor = function (converse, jid) {
        return converse.roster.get(jid).trigger("open");
    };

    utils.openChatRoom = function (_converse, room, server, nick) {
        // Opens a new chatroom
        this.openControlBox(_converse);
        this.openRoomsPanel(_converse);
        var roomspanel = _converse.chatboxviews.get('controlbox').roomspanel;
        roomspanel.$el.find('input.new-chatroom-name').val(room);
        roomspanel.$el.find('input.new-chatroom-nick').val(nick);
        roomspanel.$el.find('input.new-chatroom-server').val(server);
        roomspanel.$el.find('form').submit();
        this.closeControlBox(_converse);
    };

    utils.openAndEnterChatRoom = function (converse, room, server, nick) {
        sinon.spy(converse.connection, 'sendIQ');
        utils.openChatRoom(converse, room, server);
        var view = converse.chatboxviews.get((room+'@'+server).toLowerCase());

        // We pretend this is a new room, so no disco info is returned.
        var IQ_id = converse.connection.sendIQ.firstCall.returnValue;
        var features_stanza = $iq({
                from: 'lounge@localhost',
                'id': IQ_id,
                'to': 'dummy@localhost/desktop',
                'type': 'error'
            }).c('error', {'type': 'cancel'})
                .c('item-not-found', {'xmlns': "urn:ietf:params:xml:ns:xmpp-stanzas"});
        converse.connection._dataRecv(utils.createRequest(features_stanza));

        // The XMPP server returns the reserved nick for this user.
        IQ_id = converse.connection.sendIQ.secondCall.returnValue;
        var stanza = $iq({
            'type': 'result',
            'id': IQ_id,
            'from': view.model.get('jid'),
            'to': converse.connection.jid 
        }).c('query', {'xmlns': 'http://jabber.org/protocol/disco#info', 'node': 'x-roomuser-item'})
            .c('identity', {'category': 'conference', 'name': nick, 'type': 'text'});
        converse.connection._dataRecv(utils.createRequest(stanza));
        // The user has just entered the room (because join was called)
        // and receives their own presence from the server.
        // See example 24: http://xmpp.org/extensions/xep-0045.html#enter-pres
        var presence = $pres({
                to: converse.connection.jid,
                from: room+'@'+server+'/'+nick,
                id: 'DC352437-C019-40EC-B590-AF29E879AF97'
        }).c('x').attrs({xmlns:'http://jabber.org/protocol/muc#user'})
            .c('item').attrs({
                affiliation: 'member',
                jid: converse.bare_jid,
                role: 'occupant'
            }).up()
            .c('status').attrs({code:'110'});
        converse.connection._dataRecv(utils.createRequest(presence));
        converse.connection.sendIQ.restore();
    };

    utils.removeRosterContacts = function () {
        var model;
        while (converse.rosterview.model.length) {
            model = converse.rosterview.model.pop();
            converse.rosterview.model.remove(model);
        }
    };

    utils.clearBrowserStorage = function () {
        window.localStorage.clear();
        window.sessionStorage.clear();
        return this;
    };

    utils.clearChatBoxMessages = function (converse, jid) {
        var view = converse.chatboxviews.get(jid);
        view.$el.find('.chat-content').empty();
        view.model.messages.reset();
        view.model.messages.browserStorage._clear();
    };

    utils.createContacts = function (converse, type, length) {
        /* Create current (as opposed to requesting or pending) contacts
         * for the user's roster.
         *
         * These contacts are not grouped. See below.
         */
        var names, jid;
        if (type === 'requesting') {
            names = mock.req_names;
            subscription = 'none';
            requesting = true;
            ask = null;
        } else if (type === 'pending') {
            names = mock.pend_names;
            subscription = 'none';
            requesting = false;
            ask = 'subscribe';
        } else if (type === 'current') {
            names = mock.cur_names;
            subscription = 'both';
            requesting = false;
            ask = null;
        } else if (type === 'all') {
            this.createContacts(converse, 'current')
                .createContacts(converse, 'requesting')
                .createContacts(converse, 'pending');
            return this;
        } else {
            throw "Need to specify the type of contact to create";
        }

        if (typeof length === 'undefined') {
            length = names.length;
        }
        for (i=0; i<length; i++) {
            jid = names[i].replace(/ /g,'.').toLowerCase() + '@localhost';
            if (!converse.roster.get(jid)) {
                converse.roster.create({
                    'ask': ask,
                    'fullname': names[i],
                    'jid': jid, 
                    'requesting': requesting,
                    'subscription': subscription
                });
            }
        }
        return this;
    };

    utils.createGroupedContacts = function (converse) {
        /* Create grouped contacts
         */
        var i=0, j=0;
        _.each(_.keys(mock.groups), $.proxy(function (name) {
            j = i;
            for (i=j; i<j+mock.groups[name]; i++) {
                converse.roster.create({
                    jid: mock.cur_names[i].replace(/ /g,'.').toLowerCase() + '@localhost',
                    subscription: 'both',
                    ask: null,
                    groups: name === 'ungrouped'? [] : [name],
                    fullname: mock.cur_names[i]
                });
            }
        }, converse));
    };

    utils.sendMessage = function (chatboxview, message) {
        chatboxview.$el.find('.chat-textarea').val(message);
        chatboxview.$el.find('textarea.chat-textarea').trigger($.Event('keypress', {keyCode: 13}));
    };
    return utils;
}));
