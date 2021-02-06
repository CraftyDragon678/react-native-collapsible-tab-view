import React from 'react'
import {
  LayoutChangeEvent,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'

import { Context, TabNameContext } from './Context'
import { Lazy } from './Lazy'
import { MaterialTabBar, TABBAR_HEIGHT } from './MaterialTabBar'
import { Tab } from './Tab'
import { AnimatedFlatList, ONE_FRAME_MS, scrollToImpl } from './helpers'
import { useAnimatedDynamicRefs, useContainerRef, useTabProps } from './hooks'
import { CollapsibleProps, CollapsibleRef, TabName } from './types'

const init = (children: any) => {
  if (React.Children.count(children) === 0) {
    throw new Error('CollapsibleTabs must have at least one child.')
  }
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      throw new Error(
        'CollapsibleTabs children must be array of React Elements.'
      )
    }
  })
  return true
}

/**
 * Basic usage looks like this:
 *
 * ```tsx
 * import { createCollapsibleTabs } from 'react-native-collapsible-tab-view'
 *
 * type TabNames = 'A' | 'B'
 *
 * const Tabs = createCollapsibleTabs<TabNames>()
 *
 * const Example = () => {
 *   return (
 *     <Tabs.Container HeaderComponent={MyHeader}>
 *       <Tabs.Tab name="A">
 *         <ScreenA />
 *       </Tabs.Tab>
 *       <Tabs.Tab name="B">
 *         <ScreenB />
 *       </Tabs.Tab>
 *     </Tabs.Container>
 *   )
 * }
 * ```
 */
const Container = React.forwardRef<CollapsibleRef, CollapsibleProps>(
  (
    {
      initialTabName,
      headerHeight: initialHeaderHeight,
      minHeaderHeight = 0,
      tabBarHeight: initialTabBarHeight = TABBAR_HEIGHT,
      snapEnabled = false,
      diffClampEnabled = false,
      snapThreshold = 0.5,
      children,
      HeaderComponent,
      TabBarComponent = MaterialTabBar,
      headerContainerStyle,
      cancelTranslation,
      containerStyle,
      lazy,
      cancelLazyFadeIn,
      pagerProps,
      onIndexChange,
    },
    ref
  ) => {
    const containerRef = useContainerRef()

    const [tabProps, tabNamesArray] = useTabProps(children, Tab)

    const [refMap, setRef] = useAnimatedDynamicRefs()

    const windowWidth = useWindowDimensions().width
    const firstRender = React.useRef(init(children))

    const [containerHeight, setContainerHeight] = React.useState<
      number | undefined
    >(undefined)
    const [tabBarHeight, setTabBarHeight] = React.useState<number | undefined>(
      initialTabBarHeight
    )
    const [headerHeight, setHeaderHeight] = React.useState<number | undefined>(
      initialHeaderHeight
    )
    const isScrolling = useSharedValue(0)
    const scrollYCurrent = useSharedValue(0)
    const scrollY = useSharedValue(
      tabNamesArray.map(() => 0),
      false
    )
    const contentHeight = useSharedValue(0)
    const offset = useSharedValue(0)
    const accScrollY = useSharedValue(0)
    const oldAccScrollY = useSharedValue(0)
    const accDiffClamp = useSharedValue(0)
    const tabNames = useSharedValue<TabName[]>(tabNamesArray)
    const index = useSharedValue(
      initialTabName ? tabNames.value.findIndex((n) => n === initialTabName) : 0
    )
    const scrollX = useSharedValue(index.value * windowWidth)
    const pagerOpacity = useSharedValue(
      initialHeaderHeight === undefined || index.value !== 0 ? 0 : 1,
      false
    )
    const isSwiping = useSharedValue(false)
    const isSnapping = useSharedValue(false)
    const snappingTo = useSharedValue(0)
    const [data, setData] = React.useState(tabNamesArray)

    React.useEffect(() => {
      setData(tabNamesArray)
    }, [tabNamesArray])

    const focusedTab = useDerivedValue<TabName>(() => {
      return tabNames.value[index.value]
    }, [tabNames])
    const isGliding = useSharedValue(false)
    const endDrag = useSharedValue(0)
    const calculateNextOffset = useSharedValue(index.value)
    const headerScrollDistance = useDerivedValue(() => {
      return headerHeight !== undefined ? headerHeight - minHeaderHeight : 0
    }, [headerHeight, minHeaderHeight])

    const getItemLayout = React.useCallback(
      (_: unknown, index: number) => ({
        length: windowWidth,
        offset: windowWidth * index,
        index,
      }),
      [windowWidth]
    )

    const indexDecimal = useDerivedValue(() => {
      return scrollX.value / windowWidth
    }, [windowWidth])

    // handle window resize
    React.useEffect(() => {
      if (!firstRender.current) {
        containerRef.current?.scrollToIndex({
          index: index.value,
          animated: false,
        })
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [windowWidth])

    const afterRender = useSharedValue(0)
    React.useEffect(() => {
      if (!firstRender.current) pagerOpacity.value = 0
      afterRender.value = withDelay(
        ONE_FRAME_MS * 5,
        withTiming(1, { duration: 0 })
      )
    }, [afterRender, pagerOpacity, tabNamesArray])

    React.useEffect(() => {
      if (firstRender.current) {
        if (initialTabName !== undefined && index.value !== 0) {
          containerRef.current?.scrollToIndex({
            index: index.value,
            animated: false,
          })
        }
        firstRender.current = false
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [containerRef, initialTabName, windowWidth])

    // the purpose of this is to scroll to the proper position if dynamic tabs are changing
    useAnimatedReaction(
      () => {
        return afterRender.value === 1
      },
      (trigger) => {
        if (trigger) {
          afterRender.value = 0
          tabNamesArray.forEach((name) => {
            'worklet'
            scrollToImpl(refMap[name], 0, scrollY.value[index.value], false)
          })

          pagerOpacity.value = withTiming(1)
        }
      },
      [tabNamesArray, refMap, afterRender]
    )

    // derived from scrollX
    // calculate the next offset and index if swiping
    // if scrollX changes from tab press,
    // the same logic must be done, but knowing
    // the next index in advance
    useAnimatedReaction(
      () => {
        const nextIndex = isSwiping.value
          ? Math.round(indexDecimal.value)
          : null
        return nextIndex
      },
      (nextIndex) => {
        if (nextIndex !== null && nextIndex !== index.value) {
          calculateNextOffset.value = nextIndex
        }
      },
      []
    )

    useAnimatedReaction(
      () => {
        return calculateNextOffset.value
      },
      (i) => {
        if (i !== index.value) {
          offset.value =
            scrollY.value[index.value] - scrollY.value[i] + offset.value
          if (onIndexChange) {
            runOnJS(onIndexChange)({
              prevIndex: index.value,
              index: i,
              prevTabName: tabNames.value[index.value],
              tabName: tabNames.value[i],
            })
          }
          index.value = i
        }
      },
      []
    )

    const scrollHandlerX = useAnimatedScrollHandler(
      {
        onScroll: (event) => {
          const { x } = event.contentOffset
          scrollX.value = x
        },
        onBeginDrag: () => {
          isSwiping.value = true
        },
        onMomentumEnd: () => {
          isSwiping.value = false
        },
      },
      []
    )

    // derived from accScrollY, to calculate the accDiffClamp value
    useAnimatedReaction(
      () => {
        return diffClampEnabled ? accScrollY.value - oldAccScrollY.value : 0
      },
      (delta) => {
        if (delta) {
          const nextValue = accDiffClamp.value + delta
          if (delta > 0) {
            // scrolling down
            accDiffClamp.value = Math.min(headerScrollDistance.value, nextValue)
          } else if (delta < 0) {
            // scrolling up
            accDiffClamp.value = Math.max(0, nextValue)
          }
        }
      },
      []
    )

    const renderItem = React.useCallback(
      ({ index: i }) => {
        if (!tabNames.value[i]) return null
        return (
          <TabNameContext.Provider value={tabNames.value[i]}>
            {lazy ? (
              <Lazy
                startMounted={i === index.value}
                cancelLazyFadeIn={cancelLazyFadeIn}
              >
                {React.Children.toArray(children)[i] as React.ReactElement}
              </Lazy>
            ) : (
              React.Children.toArray(children)[i]
            )}
          </TabNameContext.Provider>
        )
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [children, lazy, tabNames.value, cancelLazyFadeIn]
    )

    const stylez = useAnimatedStyle(() => {
      return {
        transform: [
          {
            translateY: diffClampEnabled
              ? -accDiffClamp.value
              : -Math.min(scrollYCurrent.value, headerScrollDistance.value),
          },
        ],
      }
    }, [diffClampEnabled])

    const getHeaderHeight = React.useCallback(
      (event: LayoutChangeEvent) => {
        const height = event.nativeEvent.layout.height
        if (headerHeight !== height) {
          setHeaderHeight(height)
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [headerHeight]
    )

    const getTabBarHeight = React.useCallback(
      (event: LayoutChangeEvent) => {
        const height = event.nativeEvent.layout.height
        if (tabBarHeight !== height) setTabBarHeight(height)
      },
      [tabBarHeight]
    )

    const onLayout = React.useCallback(
      (event: LayoutChangeEvent) => {
        const height = event.nativeEvent.layout.height
        if (containerHeight !== height) setContainerHeight(height)
      },
      [containerHeight]
    )

    // fade in the pager if the headerHeight is not defined
    useAnimatedReaction(
      () => {
        return (
          (initialHeaderHeight === undefined || initialTabName !== undefined) &&
          headerHeight !== undefined &&
          pagerOpacity.value === 0
        )
      },
      (update) => {
        if (update) {
          pagerOpacity.value = withTiming(1)
        }
      },
      [headerHeight]
    )

    const pagerStylez = useAnimatedStyle(() => {
      return {
        opacity: pagerOpacity.value,
      }
    }, [])

    const onTabPress = React.useCallback(
      (name: TabName) => {
        // simplify logic by preventing index change
        // when is scrolling or gliding.
        if (!isScrolling.value && !isGliding.value) {
          const i = tabNames.value.findIndex((n) => n === name)
          calculateNextOffset.value = i
          if (name === focusedTab.value) {
            const ref = refMap[name]
            if (ref?.current && 'scrollTo' in ref.current) {
              ref.current?.scrollTo({
                x: 0,
                y: 0,
                animated: true,
              })
            } else if (ref?.current && 'scrollToOffset' in ref.current) {
              ref.current.scrollToOffset({
                offset: 0,
                animated: true,
              })
            }
          } else {
            containerRef.current?.scrollToIndex({ animated: true, index: i })
          }
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [containerRef, refMap]
    )

    React.useEffect(() => {
      if (index.value >= tabNamesArray.length) {
        onTabPress(tabNamesArray[tabNamesArray.length - 1])
      }
    }, [index.value, onTabPress, tabNamesArray])

    const keyExtractor = React.useCallback((name) => name, [])

    React.useImperativeHandle(
      ref,
      () => ({
        setIndex: (index) => {
          if (isScrolling.value || isGliding.value) return false
          const name = tabNames.value[index]
          onTabPress(name)
          return true
        },
        jumpToTab: (name) => {
          if (isScrolling.value || isGliding.value) return false
          onTabPress(name)
          return true
        },
        getFocusedTab: () => {
          return tabNames.value[index.value]
        },
        getCurrentIndex: () => {
          return index.value
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [onTabPress]
    )

    return (
      <Context.Provider
        value={{
          snapEnabled,
          tabBarHeight: tabBarHeight || 0,
          headerHeight: headerHeight || 0,
          refMap,
          tabNames,
          index,
          snapThreshold,
          diffClampEnabled,
          focusedTab,
          accDiffClamp,
          indexDecimal,
          containerHeight,
          scrollYCurrent,
          scrollY,
          _setRef: setRef,
          _headerScrollDistance: headerScrollDistance,
          _accScrollY: accScrollY,
          _oldAccScrollY: oldAccScrollY,
          _offset: offset,
          _isScrolling: isScrolling,
          _scrollX: scrollX,
          _isGliding: isGliding,
          _isSnapping: isSnapping,
          _snappingTo: snappingTo,
          _endDrag: endDrag,
          _contentHeight: contentHeight,
        }}
      >
        <Animated.View
          style={[styles.container, containerStyle]}
          onLayout={onLayout}
          pointerEvents="box-none"
        >
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.topContainer,
              headerContainerStyle,
              !cancelTranslation && stylez,
            ]}
          >
            <View
              style={[styles.container, styles.headerContainer]}
              onLayout={getHeaderHeight}
              pointerEvents="box-none"
            >
              {HeaderComponent && (
                <HeaderComponent
                  containerRef={containerRef}
                  index={index}
                  tabNames={tabNamesArray}
                  focusedTab={focusedTab}
                  indexDecimal={indexDecimal}
                  onTabPress={onTabPress}
                  tabProps={tabProps}
                />
              )}
            </View>
            <View
              style={[styles.container, styles.tabBarContainer]}
              onLayout={getTabBarHeight}
              pointerEvents="box-none"
            >
              {TabBarComponent && (
                <TabBarComponent
                  containerRef={containerRef}
                  index={index}
                  tabNames={tabNamesArray}
                  focusedTab={focusedTab}
                  indexDecimal={indexDecimal}
                  onTabPress={onTabPress}
                  tabProps={tabProps}
                />
              )}
            </View>
          </Animated.View>
          <AnimatedFlatList
            // @ts-expect-error problem with reanimated types, they're missing `ref`
            ref={containerRef}
            initialScrollIndex={index.value}
            data={data}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            horizontal
            pagingEnabled
            onScroll={scrollHandlerX}
            showsHorizontalScrollIndicator={false}
            getItemLayout={getItemLayout}
            scrollEventThrottle={16}
            {...pagerProps}
            style={[pagerStylez, pagerProps?.style]}
          />
        </Animated.View>
      </Context.Provider>
    )
  }
)

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topContainer: {
    position: 'absolute',
    zIndex: 100,
    width: '100%',
    backgroundColor: 'white',
    shadowColor: '#000000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.23,
    shadowRadius: 2.62,
    elevation: 4,
  },
  tabBarContainer: {
    zIndex: 1,
  },
  headerContainer: {
    zIndex: 2,
  },
})

export { Container }
