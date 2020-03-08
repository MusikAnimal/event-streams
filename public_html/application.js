$(() => {
    // Cached jQuery objects.
    const $status = $('.status-output');
    const $feed = $('.feed');
    const $toggle = $('.toggle-feed');

    // Various caching.
    const validFilters = {};
    const selectedFilters = {};

    let eventSource;
    let counter = 0;
    let running = false;

    // Set up all the valid values for each filter.
    ['type', 'log_type', 'namespace'].forEach(filter => {
        validFilters[filter] = $(`#${filter}_filter`)
            .find('option')
            .toArray()
            .map(el => el.value)
            .filter(el => 'other' !== el);
    });

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
     * Should we show this event based on the filters that are set?
     * @param {Object} data
     * @return Boolean
     */
    function shouldShowEvent(data) {
        let passed = true;

        ['type', 'namespace', 'log_type', 'log_action'].forEach(filter => {
            const selected = $(`#${filter}_filter`).val();
            const isOther = selected.includes('other')
                && !validFilters[filter].includes(data[filter]);

            if (selected.length && !(selected.includes(data[filter]) || isOther)) {
                passed = false;
            }
        });

        return passed;
    }

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

            console.log(data);

            if (++counter > 10) {
                $feed.find('tr').last().remove();
            }

            const $newRow = $('<tr>')
                // Timestamp
                .append($('<td>').text(
                    new Date(data.timestamp * 1000).toISOString()
                        .replace('T', ' ')
                        .slice(0, -5)
                ))
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

    $('form').on('submit', e => {
        e.preventDefault();
        running = !running;

        toggleOptions(running);

        if (running) {
            setStatus('connected');
            $('.output').show();

            // Cache values of filters.
            ['type', 'project', 'page', 'log_type', 'log_action', 'namespace'].forEach(filter => {
                selectedFilters[filter] = $(`#${filter}_filter`).val();
            });

            startFeed();
        } else {
            setStatus('disconnected');
            eventSource.close();
        }
    });

    $('#type_filter').on('change', e => {
        $('.namespace-filter').toggleClass(
            'hidden',
            !['edit', 'log', 'categorize', 'new'].includes(e.target.value.toString())
        );

        $('.log_type-filter').toggleClass('hidden', 'log' !== e.target.value);
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
});
