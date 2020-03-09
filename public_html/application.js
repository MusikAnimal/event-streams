$(() => {
    // Cached jQuery objects.
    const $status = $('.status-output');
    const $feed = $('.feed');
    const $toggle = $('.toggle-feed');
    const $form = $('form');

    // Various caching.
    const validFilters = {};
    let selectedFilters = {};
    const notificationBeep = new Audio('notification.wav');

    let eventSource;
    let counter = 0;
    let running = false;
    let notifications = false;

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
            $toggle.text('Start');
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

    /**
     * Should we show this event based on the filters that are set?
     * @param {Object} data
     * @return Boolean
     */
    function shouldShowEvent(data) {
        let passed = true;

        const normalize = val => undefined === val ? '' : val.toString();

        ['type', 'namespace', 'log_type', 'log_action'].forEach(filter => {
            const value = normalize(data[filter]);
            if (!value) {
                return;
            }

            const selected = selectedFilters[filter];
            const isOther = selected.includes('other')
                && !validFilters[filter].includes(value.toString());

            if (selected.length && !(contains(selected, value.toString()) || isOther)) {
                passed = false;
            }
        });

        ['title'].forEach(filter => {
            const value = normalize(data[filter]);
            const selected = selectedFilters[filter];

            if (selected && value !== selected) {
                passed = false;
            }
        });

        if (!validateProject(data)) {
            passed = false;
        }

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
     * Start the feed, printing events to the DOM as they come in.
     */
    function startFeed() {
        setStatus('connecting');

        eventSource = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange');

        eventSource.onopen = () => {
            setStatus('connected');
        };

        eventSource.onmessage = msg => {
            const data = JSON.parse(msg.data);

            if (!shouldShowEvent(data)) {
                return;
            }

            if (++counter > 10) {
                $feed.find('tr').last().remove();
            }

            console.log(data);
            notify(data);

            const $newRow = $('<tr>')
                // Timestamp
                .append($('<td>').append(getLinkForTimestamp(data)))
                // Type
                .append($('<td>').text(data.type))
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
                .append($('<td>').text(data.comment));

            $feed.prepend($newRow);
        };
    }

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

        toggleOptions(running);

        if (running) {
            setStatus('connected');
            $('.output').show();

            // Cache values of filters.
            selectedFilters = {};
            ['type', 'server_name', 'title', 'log_type', 'log_action', 'namespace'].forEach(filter => {
                selectedFilters[filter] = $(`#${filter}_filter`).val();
            });

            notifications = $('[name=notification]:checked').val();

            setQueryString();
            startFeed();
        } else {
            setStatus('disconnected');
            eventSource.close();
        }
    });

    $('#type_filter').on('change', e => {
        const selectedTypes = $(e.target).val();

        $('.namespace-filter').toggleClass(
            'hidden',
            !contains(['edit', 'log', 'categorize', 'new'], selectedTypes)
        );

        $('.title-filter').toggleClass(
            'hidden',
            !contains(['edit', 'log'], selectedTypes)
        );

        $('.log_type-filter').toggleClass('hidden', !selectedTypes.includes('log'));
    });

    const $projectFilter = $('#server_name_filter');
    const $projectFilterWrapper = $('.server_name-filter');
    $projectFilter.on('keyup', e => {
        if (e.target.value && !/^(\w+|\*)\.(wikimedia|wikipedia|wikinews|wiktionary|wikibooks|wikiversity|wikisource|wikiquote|wikidata|wikivoyage|mediawiki|\*)\.org$/.test(e.target.value)) {
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
    });

    $('.clear-feed').on('click', () => {
        $feed.html('');
        counter = 0;
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

    // Start if 'run' parameter is set.
    if (location.search.includes('run=true')) {
        $form.trigger('submit');
    }
});
