// ##############################################################################
// #    odtree
// #    author:15251908@qq.com (openliu)
// #    license:'LGPL-3
// #
// ##############################################################################
odoo.define('odtree', function (require) {
        "use strict";

        var core = require('web.core');
        var ajax = require('web.ajax');
        var ListController = require('web.ListController');
        var ListRenderer = require('web.ListRenderer');
        var FormController = require('web.FormController');
        var FormRenderer = require('web.FormRenderer');
        var KanbanController = require('web.KanbanController');
        var KanbanRenderer = require('web.KanbanRenderer');
        var rpc = require('web.rpc');
        var qweb = core.qweb;

        var node_id_selected = 0;
        var treejson = [];
        var treeObj;
        var last_view_type;
        var controller;
        var renderer;

        /**
         *
         * @param zTreeId ztree对象的id,不需要#
         * @param searchField 输入框选择器
         * @param isHighLight 是否高亮,默认高亮,传入false禁用
         * @param isExpand 是否展开,默认合拢,传入true展开
         * @returns
         */
        function fuzzySearch(zTreeId, searchField, isHighLight, isExpand, setting) {
            var zTreeObj = $.fn.zTree.getZTreeObj(zTreeId);//获取树对象
            var nameKey = setting.data.key.name; //获取name属性的key
            isHighLight = isHighLight === false ? false : true;//除直接输入false的情况外,都默认为高亮
            isExpand = isExpand ? true : false;
            setting.view.nameIsHTML = isHighLight;//允许在节点名称中使用html,用于处理高亮

            var metaChar = '[\\[\\]\\\\\^\\$\\.\\|\\?\\*\\+\\(\\)]'; //js正则表达式元字符集
            var rexMeta = new RegExp(metaChar, 'gi');//匹配元字符的正则表达式

            // 过滤ztree显示数据
            function ztreeFilter(zTreeObj, _keywords, callBackFunc) {
                if (!_keywords) {
                    _keywords = ''; //如果为空，赋值空字符串
                }

                // 查找符合条件的叶子节点
                function filterFunc(node) {
                    if (node && node.oldname && node.oldname.length > 0) {
                        node[nameKey] = node.oldname; //如果存在原始名称则恢复原始名称
                    }
                    //node.highlight = false; //取消高亮
                    zTreeObj.updateNode(node); //更新节点让之前对节点所做的修改生效
                    if (_keywords.length == 0) {
                        //如果关键字为空,返回true,表示每个节点都显示
                        zTreeObj.showNode(node);
                        zTreeObj.expandNode(node, isExpand); //关键字为空时是否展开节点
                        return true;
                    }
                    //节点名称和关键字都用toLowerCase()做小写处理
                    if (node[nameKey] && node[nameKey].toLowerCase().indexOf(_keywords.toLowerCase()) != -1) {
                        if (isHighLight) { //如果高亮，对文字进行高亮处理
                            //创建一个新变量newKeywords,不影响_keywords在下一个节点使用
                            //对_keywords中的元字符进行处理,否则无法在replace中使用RegExp
                            var newKeywords = _keywords.replace(rexMeta, function (matchStr) {
                                //对元字符做转义处理
                                return '\\' + matchStr;

                            });
                            node.oldname = node[nameKey]; //缓存原有名称用于恢复
                            //为处理过元字符的_keywords创建正则表达式,全局且不分大小写
                            var rexGlobal = new RegExp(newKeywords, 'gi');//'g'代表全局匹配,'i'代表不区分大小写
                            //无法直接使用replace(/substr/g,replacement)方法,所以使用RegExp
                            node[nameKey] = node.oldname.replace(rexGlobal, function (originalText) {
                                //将所有匹配的子串加上高亮效果
                                var highLightText =
                                    '<span style="color: whitesmoke;background-color: darkred;">'
                                    + originalText
                                    + '</span>';
                                return highLightText;
                            });
                            zTreeObj.updateNode(node); //update让更名和高亮生效
                        }
                        zTreeObj.showNode(node);//显示符合条件的节点
                        return true; //带有关键字的节点不隐藏
                    }

                    zTreeObj.hideNode(node); // 隐藏不符合要求的节点
                    return false; //不符合返回false
                }

                var nodesShow = zTreeObj.getNodesByFilter(filterFunc); //获取匹配关键字的节点
                processShowNodes(nodesShow, _keywords);//对获取的节点进行二次处理
            }

            /**
             * 对符合条件的节点做二次处理
             */
            function processShowNodes(nodesShow, _keywords) {
                if (nodesShow && nodesShow.length > 0) {
                    //关键字不为空时对关键字节点的祖先节点进行二次处理
                    if (_keywords.length > 0) {
                        $.each(nodesShow, function (n, obj) {
                            var pathOfOne = obj.getPath();//向上追溯,获取节点的所有祖先节点(包括自己)
                            if (pathOfOne && pathOfOne.length > 0) {
                                // i < pathOfOne.length-1, 对节点本身不再操作
                                for (var i = 0; i < pathOfOne.length - 1; i++) {
                                    zTreeObj.showNode(pathOfOne[i]); //显示节点
                                    zTreeObj.expandNode(pathOfOne[i], true); //展开节点
                                }
                            }
                        });
                    } else { //关键字为空则显示所有节点, 此时展开根节点
                        var rootNodes = zTreeObj.getNodesByParam('level', '0');//获得所有根节点
                        $.each(rootNodes, function (n, obj) {
                            zTreeObj.expandNode(obj, true); //展开所有根节点
                        });
                    }
                }
            }

            //监听关键字input输入框文字变化事件
            $(searchField).bind('input propertychange', function () {
                var _keywords = $(this).val();
                searchNodeLazy(_keywords); //调用延时处理
            });

            var timeoutId = null;
            // 有输入后定时执行一次，如果上次的输入还没有被执行，那么就取消上一次的执行
            function searchNodeLazy(_keywords) {
                if (timeoutId) { //如果不为空,结束任务
                    clearTimeout(timeoutId);
                }
                timeoutId = setTimeout(function () {
                    ztreeFilter(zTreeObj, _keywords);    //延时执行筛选方法
                    $(searchField).focus();//输入框重新获取焦点
                }, 500);
            }
        }

        function addHoverDom(treeId, treeNode, event) {
            var sObj = $("#" + treeNode.tId + "_span");
            if ($("#addBtn_" + treeNode.tId).length == 0) {
                var addStr = "<span class='addbutton' id='addBtn_" + treeNode.tId
                    + "' title='添加子节点' onfocus='this.blur();'></span>";
                sObj.after(addStr);
            }
            var btn = $("#addBtn_" + treeNode.tId);
            if (btn.length == 1) btn.bind("click", function () {
                renderer.getParent().$('.o_list_view_categ').remove();
                var ctx = {};
                ctx['parent_id'] = treeNode.id;
                renderer.do_action({
                    name: 'Hr Department Form',
                    type: 'ir.actions.act_window',
                    res_model: "hr.department",
                    view_mode: 'form',
                    view_type: 'form',
                    views: [[false, 'form']],
                    target: 'current',
                    context: ctx
                });
            })
        }

        function removeHoverDom(treeId, treeNode) {
            $("#addBtn_" + treeNode.tId).remove();
        };

        var buildTree = function (setting, isSearch) {
            var categ_model = renderer.arch.attrs.categ_model;
            var categ_parent_key = renderer.arch.attrs.categ_parent_key;
            var fields = ['id', 'name'];
            if (categ_parent_key != null) {
                fields.push(categ_parent_key);
            }
            var ctx = renderer.state.getContext();
            ajax.jsonRpc('/web/dataset/call_kw', 'call', {
                model: categ_model,
                method: 'search_read',
                args: [],
                kwargs: {
                    domain: [],
                    fields: fields,
                    order: 'id asc',
                    context: ctx
                }
            }).then(function (respdata) {
                if (respdata.length > 0) {
                    var treejson_cur = [];
                    for (var index = 0; index < respdata.length; index++) {
                        var obj = respdata[index];
                        var parent_id = 0;
                        if (obj.hasOwnProperty(categ_parent_key)) {
                            parent_id = obj[categ_parent_key];
                            if (parent_id !== null || parent_id !== undefined || parent_id !== false) {
                                parent_id = parent_id[0];
                            }
                        }
                        treejson_cur.push({id: obj['id'], pId: parent_id, name: obj['name'], open: true});
                    }
                    if (renderer.getParent().$('.o_list_view_categ').length === 0
                        || last_view_type !== renderer.viewType
                        || (JSON.stringify(treejson) !== JSON.stringify(treejson_cur))) {
                        last_view_type = renderer.viewType;
                        renderer.getParent().$('.o_list_view_categ').remove();
                        renderer.getParent().$('.o_kanban_view').addClass(' col-xs-12 col-md-10');
                        treejson = treejson_cur;
                        var fragment = document.createDocumentFragment();
                        var content = qweb.render('Odtree');
                        $(content).appendTo(fragment);
                        renderer.getParent().$el.prepend(fragment);
                        treeObj = $.fn.zTree.init(renderer.getParent().$('.ztree'), setting, treejson);
                        if (isSearch) fuzzySearch('ztree', '#keyword', null, true, setting); //初始化模糊搜索方法
                        renderer.getParent().$(".handle_menu_arrow").on('click', function (e) {
                            if (renderer.getParent().$('.handle_menu_arrow').hasClass("handle_menu_arrow_left")) {
                                renderer.getParent().$('.handle_menu_arrow').removeClass("handle_menu_arrow_left");
                                renderer.getParent().$('.handle_menu_arrow').addClass("handle_menu_arrow_right");
                                renderer.getParent().$('.ztree').css("display", "none");
                                renderer.getParent().$('#keyword').css('display', 'none');
                                renderer.getParent().$('.o_list_view_categ').removeClass('col-xs-12 col-md-2');
                                renderer.getParent().$('.o_list_view_categ').addClass('o_list_view_categ_hidden');
                                renderer.getParent().$('.o_kanban_view').removeClass(' col-xs-12 col-md-10');
                            } else {
                                renderer.getParent().$('.handle_menu_arrow').removeClass("handle_menu_arrow_right");
                                renderer.getParent().$('.handle_menu_arrow').addClass("handle_menu_arrow_left");
                                renderer.getParent().$('.ztree').css("display", "block");
                                renderer.getParent().$('#keyword').css('display', 'block');
                                renderer.getParent().$('.o_list_view_categ').removeClass('o_list_view_categ_hidden');
                                renderer.getParent().$('.o_list_view_categ').addClass('col-xs-12 col-md-2');
                                renderer.getParent().$('.o_kanban_view').addClass(' col-xs-12 col-md-10');
                            }
                        });
                    }
                    if (node_id_selected != null && node_id_selected > 0) {
                        var node = treeObj.getNodeByParam('id', node_id_selected, null);
                        treeObj.selectNode(node);
                    }
                }
            });

        };

        ListController.include({
            renderPager: function () {
                controller = this;
                return this._super.apply(this, arguments);
            }
        });

        KanbanController.include({
            renderPager: function () {
                controller = this;
                return this._super.apply(this, arguments);
            }
        });

        FormController.include({
            renderPager: function () {
                controller = this;
                return this._super.apply(this, arguments);
            }
        });

        //
        ListRenderer.include({

            _renderView: function () {
                renderer = this;
                var categ_model = renderer.arch.attrs.categ_model;
                var categ_property = renderer.arch.attrs.categ_property;
                var listsetting = {
                    data: {
                        simpleData: {
                            enable: true
                        }
                    },
                    showRemoveBtn: true,
                    view: {
                        showLine: false,
                    },
                    callback: {
                        onClick: function (event, treeId, treeNode, clickFlag) {
                            node_id_selected = treeNode.id;
                            var search_view = controller.searchView;
                            var search_data = search_view.build_search_data();
                            var domains = search_data.domains;
                            if (categ_property && categ_model) {
                                if (node_id_selected != null && node_id_selected > 0) {
                                    domains[domains.length] = [[categ_property, '=', node_id_selected]];
                                }
                            }
                            search_view.trigger_up('search', search_data);
                        }
                    }
                };
                var result = this._super.apply(this, arguments);
                if (this.arch.attrs.categ_property && this.arch.attrs.categ_model) {
                    this.getParent().$('.table-responsive').addClass("o_list_view_width_withcateg");
                    this.getParent().$('.table-responsive').css("width", 'auto');
                    this.getParent().$('.table-responsive').css("overflow-x", "auto");
                    buildTree(listsetting);
                } else {
                    this.getParent().$('.o_list_view_categ').remove();
                }
                return result;
            }
        });


        FormRenderer.include({

            _renderView: function () {
                renderer = this;
                var formsetting = {
                    data: {
                        simpleData: {
                            enable: true
                        },
                        key: {
                            name: 'name'
                        }
                    },
                    showRemoveBtn: true,
                    view: {
                        showLine: false,
                        addHoverDom: addHoverDom,
                        removeHoverDom: removeHoverDom,
                        nameIsHTML: true, //允许name支持html
                        selectedMulti: false

                    },
                    callback: {
                        onClick: function (event, treeId, treeNode, clickFlag) {
                            var modelName = 'hr.department';
                            rpc.query({
                                model: modelName,
                                method: 'to_action',
                                args: [treeNode.id]
                            }).then(function (action) {
                                if (!!action) {
                                    renderer.do_action(action,{clear_breadcrumbs: true});
                                }
                            });

                        }
                    }
                };
                var isSearch = True
                var result = this._super.apply(this, arguments);
                if (this.arch.attrs.categ_property && this.arch.attrs.categ_model) {
                    this.getParent().$('.o_form_view').addClass("o_list_view_width_withcateg");
                    this.getParent().$('.o_form_view').css("width", 'auto');
                    this.getParent().$('.o_form_view').css("overflow-x", "auto");
                    buildTree(formsetting, isSearch);
                } else {
                    this.getParent().$('.o_list_view_categ').remove();
                }
                return result;
            }
        });

    }
)
;
