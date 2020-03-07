$(() => {
    const $status = $('.status-output');
    const $feed = $('.feed');
    const $toggle = $('.toggle-feed');

    let eventSource;
    let counter = 0;
    let running = false;

    function makeLink(data, title, username = false) {
        return $('<a>')
            .attr('href', `${data.server}/wiki/${title}`)
            .text(username ? `User:${title}` : title);
    }

    function startFeed() {
        $status.text('Connecting...');

        eventSource = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange');

        eventSource.onopen = () => {
            $status.text('Connected');
        };

        eventSource.onmessage = msg => {
            if (++counter > 10) {
                $feed.find('tr').last().remove();
            }

            const data = JSON.parse(msg.data);

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
                    makeLink(data, `User:${data.user}`, true)
                ))
                // Title
                .append($('<td>').append(
                    makeLink(data, data.title)
                ))
                // Summary
                .append($('<td>').text(data.comment));

            $feed.prepend($newRow);
        };
    }

    $toggle.on('click', () => {
        if (running) {
            $toggle.text('Start');
            eventSource.close();
        } else {
            $toggle.text('Stop');
            startFeed();
        }

        running = !running;
    });
});
