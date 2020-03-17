$(() => {
    // Cached jQuery objects.
    const $status = $('.status-output');
    const $feed = $('.feed');
    const $toggle = $('.toggle-feed');
    const $logTypeFilter = $('.log_type-filter');
    const $form = $('form');
    const $avgNode = $('.status-avg-events');
    const $countNode = $('.status-count-events');

    // Various caching.
    const validFilters = {};
    let selectedFilters = {};
    const notificationBeep = new Audio('notification.wav');

    let eventSource;
    let counter = 0;
    let freq;
    let running = false;
    let notifications = false;
    const defaultLimit = 20;
    let limit = defaultLimit;

    /**
     * Set values of form elements based on the URL query string.
     * Adapted from https://github.com/MusikAnimal/pageviews (MIT)
     */
    function setFormFromQueryString() {
        const uri = location.search.slice(1).replace(/\+/g, '%20');
        const params = {};

        uri.split('&').forEach(chunk => {
            const [key, value] = chunk.split('=')
                .map(el => decodeURIComponent(el));

            if (!value) {
                return;
            }

            if ('limit' === key) {
                const abs = Math.abs(parseInt(value, 10) || limit);
                limit = Math.min(abs, 5000);
                $('#limit_filter').val(limit);
                return;
            }

            const $el = $(`#${key}_filter`);

            if (value.includes('|')) {
                const values = Array
                    .from(new Set(value.split('|')))
                    .map(val => val.replace(/_/g, ' '));
                $el.selectpicker('val', values);
            } else {
                $el.val(value.replace(/_/g, ' '));
            }

            // Trigger listener to show elements based on selected filter.
            // For example, if 'edit' is one of the type filters, the namespace selector should be shown.
            $el.trigger('change');
        });

        return params;
    }

    /**
     * Set the status text.
     * @param {String} status Either 'disconnected', 'connecting', or 'connected'.
     */
    function setStatus(status) {
        $status.removeClass('text-danger text-info text-success');
        if ('disconnected' === status) {
            $status.text('Not connected')
                .addClass('text-danger');
            $toggle.text('Connect');
        } else if ('connecting' === status) {
            $status.text('Connecting...')
                .addClass('text-info');
        } else if ('connected' === status) {
            $status.text('Connected')
                .addClass('text-success');
            $toggle.text('Stop');
        }
    }

    /**
     * Check if any elements of the needle array are in the haystack.
     * @param {Array|String} needle
     * @param {Array|String} haystack
     * @return {boolean}
     */
    function contains(needle, haystack) {
        return $.makeArray(needle).some(val => $.makeArray(haystack).includes(val));
    }

    /**
     * Whether the event is in the filtered project (which might be a wildcard).
     * @param {Object} data
     * @return {Boolean}
     */
    function validateProject(data) {
        if (!selectedFilters.server_name) {
            return true;
        }

        if (selectedFilters.server_name.includes('*')) {
            return new RegExp(
                selectedFilters.server_name
                    .replace(/\*/g, '.*')
                    .replace(/\./g, '.')
            ).test(data.server_name);
        } else {
            return selectedFilters.server_name === data.server_name;
        }
    }

    function isIP(username) {
        return /^(\d+\.\d+\.\d+\.\d+|[A-Z0-9]{1,4}:[A-Z0-9]{1,4}:[A-Z0-9]{1,4}:[A-Z0-9]{1,4}:[A-Z0-9]{1,4}:[A-Z0-9]{1,4}:[A-Z0-9]{1,4}:[A-Z0-9]{1,4})/.test(username);
    }

    /**
     * Should we show this event based on the filters that are set?
     * @param {Object} data
     * @return Boolean
     */
    function shouldShowEvent(data) {
        let passed = true;

        /**
         * All values should be stringified, such as 0 for the namespace.
         * @param {*} val
         * @return {string}
         */
        const normalize = val => {
            return undefined === val ? '' : val.toString();
        };

        ['type', 'namespace', 'log_type', 'log_action'].forEach(filter => {
            const value = normalize(data[filter]);
            if (!value) {
                return;
            }

            const selected = selectedFilters[filter] || [];
            const isOther = selected.includes('other')
                && !validFilters[filter].includes(value.toString());

            if (selected.length && !(contains(selected, value.toString()) || isOther)) {
                passed = false;
            }
        });

        ['title'].forEach(filter => {
            const value = normalize(data[filter]);
            const selected = selectedFilters[filter] || '';

            if (selected && value !== selected) {
                passed = false;
            }
        });

        if (!validateProject(data)) {
            passed = false;
        }

        // User filter.
        if ('ip' === selectedFilters.user && !isIP(data.user)) {
            passed = false;
        } else if ('non_bot' === selectedFilters.user && data.bot) {
            passed = false;
        } else if ('non_bot_account' === selectedFilters.user && (data.bot || isIP(data.user))) {
            passed = false;
        } else if ('bot' === selectedFilters.user && !data.bot) {
            passed = false;
        }

        // Edit filters.
        ['minor', 'patrolled'].forEach(filter => {
            if ('all' !== selectedFilters[filter]) {
                const state = parseInt(selectedFilters[filter], 10);
                if ((state && false === data[filter]) || (!state && (true === data[filter] || undefined === data[filter]))) {
                    passed = false;
                }
            }
        });

        return passed;
    }

    /**
     * Get URL linking to the event.
     * @param {Object} data
     * @return {String|null}
     */
    function getUrlForEvent(data) {
        let path = '';

        if ('edit' === data.type) {
            path = `Special:Diff/${data.revision.new}`;
        } else if ('log' === data.type) {
            if ('abusefilter' === data.log_type) {
                path = `Special:AbuseLog/${data.log_params.log}`;
            } else {
                path = `Special:Redirect/logid/${data.log_id}`;
            }
        }

        return path ? `${data.server_url}/wiki/${path}` : null;
    }

    /**
     * Get link to the event (edit, log entry, etc.) on the wiki.
     * @param {Object} data
     * @return {jQuery|String}
     */
    function getLinkForTimestamp(data) {
        const dateString = new Date(data.timestamp * 1000).toISOString()
            .replace('T', ' ')
            .slice(0, -5);
        const url = getUrlForEvent(data);

        if (url) {
            return $('<a>')
                .attr('href', url)
                .prop('target', '_blank')
                .text(dateString);
        }

        return dateString;
    }

    // /**
    //  * Escape HTML in the given text.
    //  * @see https://stackoverflow.com/a/4835406/604142 (CC BY-SA 4.0)
    //  * @param {String} text
    //  */
    // function escapeHtml(text) {
    //     const map = {
    //         '&': '&amp;',
    //         '<': '&lt;',
    //         '>': '&gt;',
    //         '"': '&quot;',
    //         "'": '&#039;',
    //     };
    //
    //     return text.replace(/[&<>"']/g, m => map[m]);
    // }

    /**
     * Get the HTML-ready summary (i.e. comment) associated with the event,
     * correcting URLs and making them open in a new tab.
     * @param {Object} data
     * @return {string}
     */
    function getHtmlForSummary(data) {
        if (!data.comment) {
            return '';
        }

        return data.parsedcomment.replace(
            /href="\/wiki\//g,
            `href="${data.server_url}/wiki/`
        ).replace(
            /href="/g,
            'target="_blank" href="'
        );
    }

    /**
     * Issue push notification or sound.
     * @param {Object} data
     */
    function notify(data) {
        if (!notifications || 'none' === notifications) {
            return;
        }

        if ('sound' === notifications) {
            notificationBeep.play();
            return;
        }
        if ('denied' === Notification.permission) {
            return;
        }

        const spawnNotif = () => {
            const url = getUrlForEvent(data);
            const notification = new Notification(
                `[Event Streams] [${data.type}] [${data.server_name}]`,
                {
                    body: `${data.user} at [[${data.title}]]: ${url}`,
                    url,
                }
            );
            notification.onclick = e => {
                e.preventDefault();
                window.open(e.target.data.url);
            };
        };

        if ('denied' !== Notification.permission) {
            Notification.requestPermission().then(permission => {
                if ('granted' === permission) {
                    spawnNotif();
                }
            });
        } else {
            spawnNotif();
        }
    }

    /**
     * Get single-character representations of flags for the event,
     * such as 'm' for minor edit and 'b' for bot.
     * @param {Object} data
     * @return {String}
     */
    function getFlagsForEvent(data) {
        let html = '';

        // Bot
        html += data.bot ? '<abbr title="This edit was performed by a bot">b</abbr>' : '&nbsp;';

        // Minor
        html += data.minor ? '<abbr title="This is a minor edit">m</abbr>' : '&nbsp;';

        // Unpatrolled
        html += (undefined !== data.patrolled && !data.patrolled)
            ? '<abbr class="unpatrolled" title="This edit has not yet been patrolled">!</abbr>'
            : '&nbsp';

        return html;
    }

    /**
     * Start the feed, printing events to the DOM as they come in.
     */
    function startFeed() {
        setStatus('connecting');

        eventSource = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange');

        eventSource.onopen = () => {
            setStatus('connected');

            freq = new window.Frequency(1000, (_count, average) => {
                $avgNode.text(average);
            });
        };

        eventSource.onmessage = msg => {
            const data = JSON.parse(msg.data);

            if (!shouldShowEvent(data)) {
                return;
            }

            if (freq) {
                freq.add(1);
            }

            if (counter++ > limit) {
                $feed.find('tr').slice(limit - 1).remove();
            }

            $countNode.text(counter);

            console.log(data);
            notify(data);

            const $newRow = $('<tr>')
                // Timestamp
                .append($('<td>').append(getLinkForTimestamp(data)))
                // Type
                .append($('<td>').text(data.type))
                // Flags
                .append($('<td>')
                    .addClass('event-flags')
                    .html(getFlagsForEvent(data))
                )
                // Wiki
                .append($('<td>').text(data.server_name.replace('.org', '')))
                // User
                .append($('<td>').append(
                    $('<a>').attr('href', `${data.server_url}/wiki/User:${data.user}`)
                        .text(data.user)
                        .prop('target', '_blank')
                ))
                // Title
                .append($('<td>').append(
                    $('<a>').attr('href', data.meta.uri)
                        .text(data.title)
                        .prop('target', '_blank')
                ))
                // Summary
                .append($('<td>').html(getHtmlForSummary(data)));

            $feed.prepend($newRow);
        };
    }

    /**
     * Toggle display of the Options panel
     * @param {Boolean} forceShow
     */
    function toggleOptions(forceShow = null) {
        const $icon = $('.options-toggle-icon');
        const open = null !== forceShow ? forceShow : $icon.hasClass('glyphicon-chevron-right');

        if (open) {
            $icon.removeClass('glyphicon-chevron-right');
            $icon.addClass('glyphicon-chevron-down');
            $('.options-panel').hide();
        } else {
            $icon.addClass('glyphicon-chevron-right');
            $icon.removeClass('glyphicon-chevron-down');
            $('.options-panel').show();
        }
    }

    /**
     * Update the URL query string based on the selected filters.
     */
    function setQueryString() {
        const parts = [];

        Object.keys(selectedFilters).forEach(filter => {
            const value = selectedFilters[filter];

            if ('all' === value) {
                // This doesn't need to be in the query string as it's the default.
                return;
            }
            if ($(`#${filter}_filter`).prop('disabled')) {
                // Shouldn't be included in the query string.
                return;
            }

            if (Array.isArray(value) && value.length) {
                parts.push(`${filter}=${value.join('|')}`);
            } else if (value.length) {
                parts.push(`${filter}=${value}`);
            }
        });

        window.history.replaceState(
            {},
            document.title,
            parts.length ? `?${parts.join('&')}` : ''
        );
    }

    /**
     * LISTENERS
     */

    $form.on('submit', e => {
        e.preventDefault();
        running = !running;

        if (running) {
            toggleOptions(true);
            setStatus('connected');
            $('.output').show();

            // Cache values of filters.
            selectedFilters = {};
            ['type', 'server_name', 'title', 'log_type', 'log_action', 'namespace', 'minor', 'patrolled'].forEach(filter => {
                const $el = $(`#${filter}_filter`);
                if (!$el.prop('disabled') && $el.val()) {
                    selectedFilters[filter] = $el.val();
                }
            });

            // Title overrides namespace.
            if (selectedFilters.namespace && selectedFilters.title) {
                selectedFilters.namespace = '';
                // $('#title_filter').trigger('keyup');
            }

            selectedFilters.user = $('[name=user_filter]:checked').val();

            notifications = $('[name=notification]:checked').val();

            limit = parseInt($('#limit_filter').val(), 0);
            counter = 0;
            $avgNode.text('0');
            $countNode.text('0');
            $feed.html('');

            setQueryString();
            startFeed();
            $('.status-avg-events-wrapper').removeClass('hidden');
        } else {
            setStatus('disconnected');
            eventSource.close();
            eventSource = null;
            freq.kill();
        }
    });

    /**
     * Enable/show or disable/hide the given filter.
     * @param {String} id
     * @param {Boolean} toggle
     * @param {Boolean} wrapper Whether we're just showing/hiding a filter section instead of individual inputs.
     */
    function toggleFilter(id, toggle, wrapper = false) {
        if (wrapper) {
            $(`.${id}-filters-wrapper`).toggleClass('hidden', !toggle);
            return;
        }

        $(`.${id}-filter`).toggleClass('hidden', !toggle);
        $(`#${id}_filter`).prop('disabled', !toggle);

        if (!toggle) {
            delete selectedFilters[id];
        }
    }

    $('#type_filter').on('change', e => {
        const selectedTypes = $(e.target).val();

        // Page filters
        toggleFilter('page', contains(['edit', 'log', 'new'], selectedTypes), true);
        toggleFilter('namespace', contains(['edit', 'log', 'categorize', 'new'], selectedTypes));
        toggleFilter('title', contains(['edit', 'log'], selectedTypes));

        // Log filters
        const showLogOptions = selectedTypes.includes('log');
        toggleFilter('log', showLogOptions, true);
        toggleFilter('log_type', showLogOptions);
        toggleFilter(
            'log_action',
            showLogOptions && $('#log_type_filter').val().length
        );

        // Edit filters.
        toggleFilter('edit', contains(['edit'], selectedTypes), true);
        toggleFilter('minor', contains(['edit'], selectedTypes));
        toggleFilter('patrolled', contains(['edit'], selectedTypes));
    });

    $logTypeFilter.on('change', e => {
        const $actionFilter = $('#log_action_filter');
        $actionFilter.html('');

        // First grab the available actions for the selected log types.
        const actionMap = {};
        $(e.target).val().forEach(type => {
            if (!window.logActionMap[type]) {
                return;
            }
            actionMap[type] = window.logActionMap[type];
        });

        // Hide if there are not available log actions.
        if (!Object.keys(actionMap).length) {
            toggleFilter('log_action', false);
            return;
        }

        // Populate the dropdown.
        Object.keys(actionMap).forEach((type, index) => {
            if (index > 0) {
                $actionFilter.append(
                    $('<option>').attr('data-divider', 'true')
                );
            }
            Object.keys(actionMap[type]).forEach(action => {
                $actionFilter.append(
                    $('<option>').prop('value', action)
                        .text(actionMap[type][action])
                );
            });
        });
        toggleFilter('log_action', true);
        $actionFilter.selectpicker('refresh');
    });

    const $projectFilter = $('#server_name_filter');
    const $projectFilterWrapper = $('.server_name-filter');
    $projectFilter.on('keyup', e => {
        if (e.target.value && !/^(\w+|\*)\.(wikimedia|wikipedia|wikinews|wiktionary|wikibooks|wikiversity|wikisource|wikiquote|wikidata|wikivoyage|mediawiki|\*)(?:\.org)?$/.test(e.target.value)) {
            $projectFilterWrapper.addClass('has-error');
        } else {
            $projectFilterWrapper.removeClass('has-error');
        }
    });
    $projectFilter.on('change', e => {
        if (e.target.value && !/\.org$/.test(e.target.value)) {
            $projectFilter.val(`${e.target.value}.org`)
                .trigger('keyup');
        }
    });

    $('.options-toggle-heading').on('click', () => {
        if ($('.bootstrap-select.open').length) {
            // Don't toggle if they're clicking outside a multiselect dropdown.
            return;
        }

        toggleOptions();

        if (eventSource) {
            // Stop the feed, since you need to submit for filter changes to take effect.
            $toggle.trigger('click');
        }
    });

    $('.reset-form').on('click', () => {
        $feed.html('');
        counter = 0;
        $('.status-avg-events-wrapper').addClass('hidden');
        setStatus('disconnected');
        if (eventSource) {
            eventSource.close();
        }
        $form[0].reset();
        $('.selectpicker').selectpicker('deselectAll')
            .selectpicker('refresh');
        $('#limit_filter').val(defaultLimit);
        $('.output').hide();
        running = false;
        toggleOptions(false);
        selectedFilters = {};
        window.history.replaceState(null, null, window.location.pathname);
    });

    /**
     * ENTRY POINT
     */

    // Update form from URL query string.
    setFormFromQueryString();

    // Set up all the valid values for each filter.
    ['type', 'log_type', 'namespace'].forEach(filter => {
        validFilters[filter] = $(`#${filter}_filter`)
            .find('option')
            .toArray()
            .map(el => el.value)
            .filter(el => 'other' !== el);
    });

    $('[data-toggle="tooltip"]').tooltip();

    // Start the feed.
    if (!location.search.includes('norun=')) {
        $form.trigger('submit');
    }
});
