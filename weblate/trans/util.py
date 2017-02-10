# -*- coding: utf-8 -*-
#
# Copyright © 2012 - 2017 Michal Čihař <michal@cihar.com>
#
# This file is part of Weblate <https://weblate.org/>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.
#

from __future__ import unicode_literals

import os
import sys
import unicodedata

from django.contrib.admin import ModelAdmin
from django.core.cache import cache
from django.http import HttpResponseRedirect
from django.shortcuts import resolve_url, render as django_render
from django.utils.encoding import force_text
from django.utils.translation import ugettext as _, ugettext_lazy

try:
    import pyuca  # pylint: disable=import-error
    HAS_PYUCA = True
except ImportError:
    HAS_PYUCA = False

from siphashc import siphash

import six
from six.moves.urllib.parse import urlparse

from weblate.trans.data import data_dir

PLURAL_SEPARATOR = '\x1e\x1e'

# List of default domain names on which warn user
DEFAULT_DOMAINS = ('example.net', 'example.com')

PRIORITY_CHOICES = (
    (60, ugettext_lazy('Very high')),
    (80, ugettext_lazy('High')),
    (100, ugettext_lazy('Medium')),
    (120, ugettext_lazy('Low')),
    (140, ugettext_lazy('Very low')),
)


def calculate_hash(source, context):
    """Calculates checksum identifying translation."""
    if source is not None:
        data = source.encode('utf-8') + context.encode('utf-8')
    else:
        data = context.encode('utf-8')
    # Need to convert it from unsigned 64-bit int to signed 64-bit int
    return siphash('Weblate Sip Hash', data) - 2**63


def checksum_to_hash(checksum):
    """Convert hex to id_hash (signed 64-bit int)"""
    return int(checksum, 16) - 2**63


def hash_to_checksum(id_hash):
    """Convert id_hash (signed 64-bit int) to unsigned hex"""
    return format(id_hash + 2**63, 'x')


def is_plural(text):
    '''
    Checks whether string is plural form.
    '''
    return text.find(PLURAL_SEPARATOR) != -1


def split_plural(text):
    return text.split(PLURAL_SEPARATOR)


def join_plural(text):
    return PLURAL_SEPARATOR.join(text)


def get_string(text):
    '''
    Returns correctly formatted string from ttkit unit data.
    '''
    # Check for null target (happens with XLIFF)
    if text is None:
        return ''
    if hasattr(text, 'strings'):
        return join_plural(text.strings)
    return text


def is_repo_link(val):
    '''
    Checks whether repository is just a link for other one.
    '''
    return val.startswith('weblate://')


def get_distinct_translations(units):
    '''
    Returns list of distinct translations. It should be possible to use
    distinct('target') since Django 1.4, but it is not supported with MySQL, so
    let's emulate that based on presumption we won't get too many results.
    '''
    targets = {}
    result = []
    for unit in units:
        if unit.target in targets:
            continue
        targets[unit.target] = 1
        result.append(unit)
    return result


def translation_percent(translated, total):
    '''
    Returns translation percentage.
    '''
    if total == 0 or total is None:
        return 0.0
    perc = round(1000 * translated / total) / 10.0
    # Avoid displaying misleading rounded 0.0% or 100.0%
    if perc == 0.0 and translated != 0:
        return 0.1
    if perc == 100.0 and translated != total:
        return 99.9
    return perc


def add_configuration_error(name, message):
    """
    Logs configuration error.
    """
    errors = cache.get('configuration-errors', [])
    errors.append({
        'name': name,
        'message': message,
    })
    cache.set('configuration-errors', errors)


def get_configuration_errors():
    """
    Returns all configuration errors.
    """
    return cache.get('configuration-errors', [])


def get_clean_env(extra=None):
    """
    Returns cleaned up environment for subprocess execution.
    """
    environ = {
        'LANG': 'en_US.UTF-8',
        'HOME': data_dir('home'),
    }
    if extra is not None:
        environ.update(extra)
    variables = ('PATH', 'LD_LIBRARY_PATH')
    for var in variables:
        if var in os.environ:
            environ[var] = os.environ[var]
    # Python 2 on Windows doesn't handle Unicode objects in environment
    # even if they can be converted to ASCII string, let's fix it here
    if six.PY2 and sys.platform == 'win32':
        return {
            str(key): str(val) for key, val in environ.items()
        }
    return environ


def cleanup_repo_url(url):
    """
    Removes credentials from repository URL.
    """
    parsed = urlparse(url)
    if parsed.username and parsed.password:
        return url.replace(
            '{0}:{1}@'.format(
                parsed.username,
                parsed.password
            ),
            ''
        )
    elif parsed.username:
        return url.replace(
            '{0}@'.format(
                parsed.username,
            ),
            ''
        )
    return url


def redirect_param(location, params, *args, **kwargs):
    """
    Redirects to a URL with parameters.
    """
    return HttpResponseRedirect(
        resolve_url(location, *args, **kwargs) + params
    )


def cleanup_path(path):
    """
    Removes leading ./ or / from path.
    """
    if path.startswith('./'):
        path = path[2:]
    if path.startswith('/'):
        path = path[1:]
    return path


def get_project_description(project):
    """Returns verbose description for project translation"""
    return _(
        '{0} is translated into {1} languages using Weblate. '
        'Join the translation or start translating your own project.',
    ).format(
        project,
        project.get_language_count()
    )


def render(request, template, context=None, status=None):
    """Wrapper around Django render to extend context"""
    if context is None:
        context = {}
    if 'project' in context and context['project'] is not None:
        context['description'] = get_project_description(context['project'])
    return django_render(request, template, context, status=status)


def path_separator(path):
    """Always use / as path separator for consistency"""
    if os.path.sep != '/':
        return path.replace(os.path.sep, '/')
    return path


def sort_unicode(choices, key):
    """Unicode aware sorting if available"""
    if not HAS_PYUCA:
        return sorted(
            choices,
            key=lambda tup: remove_accents(key(tup)).lower()
        )
    else:
        collator = pyuca.Collator()
        return sorted(
            choices,
            key=lambda tup: collator.sort_key(force_text(key(tup)))
        )


def remove_accents(input_str):
    """
    Removes accents from a string.
    """
    nkfd_form = unicodedata.normalize('NFKD', force_text(input_str))
    only_ascii = nkfd_form.encode('ASCII', 'ignore')
    return only_ascii


def sort_choices(choices):
    '''
    Sorts choices alphabetically.

    Either using cmp or pyuca.
    '''
    return sort_unicode(choices, lambda tup: tup[1])


def sort_objects(objects):
    """Sorts objects alphabetically"""
    return sort_unicode(objects, force_text)


class WeblateAdmin(ModelAdmin):
    """Model admin which doesn't list objects to delete"""
    def render_delete_form(self, request, context):
        context['deleted_objects'] = [_('Object listing disabled')]
        return super(WeblateAdmin, self).render_delete_form(request, context)


def check_domain(domain):
    """Checks whether site domain is correctly set"""
    return (
        domain not in DEFAULT_DOMAINS and
        not domain.startswith('http:') and
        not domain.startswith('https:') and
        not domain.endswith('/')
    )
